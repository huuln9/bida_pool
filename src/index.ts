import {
  computeLeaderboard,
  cupDefaultsForRank,
  type Player,
  type Result,
  type Row,
  type Session,
} from "./scoring";
import { tgCall, verifyInitData, type TgUser } from "./telegram";

// Kiểu tối thiểu cho D1 (đủ dùng, khỏi cài thêm thư viện).
interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = any>(): Promise<D1Result<T>>;
  first<T = any>(): Promise<T | null>;
  run(): Promise<{ meta: { last_row_id: number; changes: number } }>;
}
interface D1Database {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(req: Request): Promise<Response> };
  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  ADMIN_IDS?: string; // VD: "123456789,987654321"
  DEV_MODE?: string; // "1" chỉ dùng khi chạy local: bỏ qua xác thực, ai cũng là admin
}

// ---------- tiện ích ----------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Auth { user: TgUser | null; isAdmin: boolean }

async function getAuth(req: Request, env: Env): Promise<Auth> {
  if (env.DEV_MODE === "1") return { user: { id: 0, first_name: "Dev" }, isAdmin: true };
  const initData = req.headers.get("x-telegram-init-data") ?? "";
  const user = await verifyInitData(initData, env.BOT_TOKEN ?? "");
  const admins = (env.ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { user, isAdmin: !!user && admins.includes(String(user.id)) };
}

function requireAdmin(auth: Auth) {
  if (!auth.user) throw new HttpError(401, "Hãy mở app từ trong Telegram.");
  if (!auth.isAdmin) throw new HttpError(403, "Chỉ admin mới được sửa dữ liệu.");
}

/** Ghi chú nhiều dòng: bỏ dòng trống, tối đa 10 dòng x 120 ký tự. */
function cleanNote(v: unknown): string | null {
  const lines = String(v ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s*•\-]+/, "").trim())
    .filter(Boolean);
  if (lines.length > 10 || lines.some((l) => l.length > 120)) {
    throw new HttpError(400, "Ghi chú tối đa 10 dòng, mỗi dòng 120 ký tự.");
  }
  return lines.length ? lines.join("\n") : null;
}

/** Màu đại diện dạng #rrggbb; rỗng = dùng màu mặc định. */
function cleanColor(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^#[0-9a-f]{6}$/.test(s)) throw new HttpError(400, "Màu không hợp lệ.");
  return s;
}

/** Lưu màu cơ thủ. Báo lỗi rõ nếu DB cũ chưa có cột color. */
async function saveColor(db: D1Database, id: number, color: string | null) {
  try {
    await db.prepare("UPDATE players SET color = ? WHERE id = ?").bind(color, id).run();
  } catch (e) {
    if (String(e).includes("no such column")) {
      throw new HttpError(500, "DB chưa có cột color. Chạy: ALTER TABLE players ADD COLUMN color TEXT;");
    }
    throw e;
  }
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;

// ---------- truy vấn ----------
type SessionRow = Session & { published: number };

/** includeDrafts = true: lấy cả giải chưa công khai (chỉ dành cho admin). */
async function loadAll(db: D1Database, includeDrafts = false) {
  const where = includeDrafts ? "" : " WHERE published = 1";
  const [p, s, r] = await Promise.all([
    db.prepare("SELECT id, name, note FROM players ORDER BY id").all<Player>(),
    db
      .prepare(`SELECT id, date, published FROM sessions${where} ORDER BY date, id`)
      .all<SessionRow>()
      // DB cũ chưa có cột published: coi như tất cả đã công khai
      .catch(() => db.prepare("SELECT id, date, 1 AS published FROM sessions ORDER BY date, id").all<SessionRow>()),
    db.prepare("SELECT session_id, player_id, type, win, lose, rank FROM results").all<Result>(),
  ]);
  const ids = new Set(s.results.map((x) => x.id));
  return { players: p.results, sessions: s.results, results: r.results.filter((x) => ids.has(x.session_id)) };
}

/** Phiên bản ảnh đại diện của từng cơ thủ: { player_id: updated_at }. Trống nếu chưa tạo bảng avatars. */
async function avatarVersions(db: D1Database): Promise<Record<number, string>> {
  try {
    const r = await db.prepare("SELECT player_id, updated_at FROM avatars").all<{ player_id: number; updated_at: string }>();
    return Object.fromEntries(r.results.map((a) => [a.player_id, a.updated_at]));
  } catch {
    return {};
  }
}

const STREAK_RECENT = 10;

/** Chuỗi tham gia liên tiếp: hiện tại (tính tới giải gần nhất), kỷ lục, và 10 giải gần nhất (cũ → mới). */
function streaks(sessions: Session[], results: Result[]) {
  const attended = new Map<number, Set<number>>(); // session_id -> player_ids
  for (const r of results) {
    if (!attended.has(r.session_id)) attended.set(r.session_id, new Set());
    attended.get(r.session_id)!.add(r.player_id);
  }
  const ids = new Set(results.map((r) => r.player_id));
  const out = new Map<number, { streak: number; best_streak: number; recent: boolean[] }>();
  for (const pid of ids) {
    let cur = 0, best = 0;
    const seq = sessions.map((s) => !!attended.get(s.id)?.has(pid));
    for (const on of seq) {
      cur = on ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    out.set(pid, { streak: cur, best_streak: best, recent: seq.slice(-STREAK_RECENT) });
  }
  return out;
}

async function leaderboard(env: Env, includeDrafts = false) {
  const { players, sessions, results } = await loadAll(env.DB, includeDrafts);
  const st = streaks(sessions, results);
  const none = { streak: 0, best_streak: 0, recent: [] as boolean[] };
  return {
    rows: computeLeaderboard(players, sessions, results).map((r) => ({ ...r, ...(st.get(r.player_id) ?? none) })),
    latest: sessions[sessions.length - 1] ?? null,
    sessionCount: sessions.length,
    draftCount: sessions.filter((s) => !s.published).length,
    avatars: await avatarVersions(env.DB),
  };
}

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
const AVATAR_MAX_BYTES = 400 * 1024;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface SessionInput {
  date: string;
  league: { player_id: number; win: number; lose: number }[];
  cup: { player_id: number; rank: number; win?: number; lose?: number }[];
}

function parseSession(body: any, playerIds: Set<number>): SessionInput {
  if (!isDate(body?.date)) throw new HttpError(400, "Ngày không hợp lệ (YYYY-MM-DD).");
  const league = Array.isArray(body.league) ? body.league : [];
  const cup = Array.isArray(body.cup) ? body.cup : [];
  if (league.length === 0 && cup.length === 0) throw new HttpError(400, "Chưa nhập kết quả nào.");
  const seen = new Set<string>();
  for (const l of league) {
    if (!playerIds.has(l.player_id)) throw new HttpError(400, "Cơ thủ không tồn tại.");
    if (!isCount(l.win) || !isCount(l.lose)) throw new HttpError(400, "Số trận League không hợp lệ.");
    if (seen.has("L" + l.player_id)) throw new HttpError(400, "Trùng cơ thủ trong League.");
    seen.add("L" + l.player_id);
  }
  for (const c of cup) {
    if (!playerIds.has(c.player_id)) throw new HttpError(400, "Cơ thủ không tồn tại.");
    if (!Number.isInteger(c.rank) || c.rank < 1 || c.rank > 16) throw new HttpError(400, "Hạng Cup không hợp lệ.");
    const d = cupDefaultsForRank(c.rank);
    c.win ??= d.win;
    c.lose ??= d.lose;
    if (!isCount(c.win) || !isCount(c.lose)) throw new HttpError(400, "Số trận Cup không hợp lệ.");
    if (seen.has("C" + c.player_id)) throw new HttpError(400, "Trùng cơ thủ trong Cup.");
    seen.add("C" + c.player_id);
  }
  return { date: body.date, league, cup };
}

function resultStmts(db: D1Database, sessionId: number, s: SessionInput): D1Stmt[] {
  const ins = "INSERT INTO results (session_id, player_id, type, win, lose, rank) VALUES (?, ?, ?, ?, ?, ?)";
  return [
    ...s.league.map((l) => db.prepare(ins).bind(sessionId, l.player_id, "LEAGUE", l.win, l.lose, null)),
    ...s.cup.map((c) => db.prepare(ins).bind(sessionId, c.player_id, "CUP", c.win, c.lose, c.rank)),
  ];
}

// ---------- API ----------
async function api(req: Request, env: Env, path: string): Promise<Response> {
  const method = req.method;
  const auth = await getAuth(req, env);
  const db = env.DB;
  const body = method === "POST" || method === "PUT" ? await req.json().catch(() => ({})) : null;
  let m: RegExpMatchArray | null;

  if (path === "/api/me" && method === "GET") {
    // Ghi lại người đã mở app (thông tin Telegram đã xác thực). Bỏ qua nếu chưa tạo bảng visitors.
    const u = auth.user;
    if (u && u.id) {
      await db
        .prepare(
          "INSERT INTO visitors (tg_id, first_name, last_name, username, photo_url) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(tg_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, " +
            "username = excluded.username, photo_url = excluded.photo_url, last_seen = datetime('now')",
        )
        .bind(u.id, u.first_name ?? null, u.last_name ?? null, u.username ?? null, u.photo_url ?? null)
        .run()
        .catch(() => {});
    }
    return json({ user: auth.user, isAdmin: auth.isAdmin });
  }
  if (path === "/api/visitors" && method === "GET") {
    requireAdmin(auth);
    try {
      const r = await db.prepare("SELECT * FROM visitors ORDER BY last_seen DESC").all();
      return json(r.results);
    } catch {
      throw new HttpError(500, "Chưa tạo bảng visitors trong D1.");
    }
  }
  if (path === "/api/leaderboard" && method === "GET") {
    const all = auth.isAdmin && new URL(req.url).searchParams.get("all") === "1";
    return json(await leaderboard(env, all));
  }

  // --- ảnh đại diện ---
  if ((m = path.match(/^\/api\/avatar\/(\d+)$/)) && method === "GET") {
    let row: { mime: string; data: string } | null = null;
    try {
      row = await db.prepare("SELECT mime, data FROM avatars WHERE player_id = ?").bind(Number(m[1])).first();
    } catch {}
    if (!row) return new Response("Not found", { status: 404 });
    return new Response(b64ToBytes(row.data), {
      headers: { "content-type": row.mime, "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if ((m = path.match(/^\/api\/players\/(\d+)\/avatar$/))) {
    requireAdmin(auth);
    const id = Number(m[1]);
    const exists = await db.prepare("SELECT id FROM players WHERE id = ?").bind(id).first();
    if (!exists) throw new HttpError(404, "Không tìm thấy cơ thủ.");
    if (method === "POST") {
      const match = String(body?.data ?? "").match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !AVATAR_TYPES.includes(match[1])) throw new HttpError(400, "Ảnh phải là PNG, JPG hoặc WebP.");
      if (match[2].length * 0.75 > AVATAR_MAX_BYTES) throw new HttpError(400, "Ảnh quá lớn (tối đa 400 KB).");
      try {
        await db
          .prepare(
            "INSERT INTO avatars (player_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now')) " +
              "ON CONFLICT(player_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
          )
          .bind(id, match[1], match[2])
          .run();
      } catch (e) {
        if (String(e).includes("no such table")) {
          throw new HttpError(500, "Chưa tạo bảng avatars trong D1. Chạy lệnh SQL trong hướng dẫn trước.");
        }
        throw e;
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM avatars WHERE player_id = ?").bind(id).run().catch(() => {});
      return json({ ok: true });
    }
  }

  // --- cơ thủ ---
  if (path === "/api/players" && method === "GET") {
    // DB cũ chưa có cột color thì vẫn chạy bình thường (color = null)
    const players = (
      await db
        .prepare("SELECT id, name, note, color FROM players ORDER BY name")
        .all<Player & { color: string | null }>()
        .catch(() => db.prepare("SELECT id, name, note, NULL AS color FROM players ORDER BY name").all<Player & { color: string | null }>())
    ).results;
    const av = await avatarVersions(db);
    return json(players.map((p) => ({ ...p, avatar_v: av[p.id] ?? null })));
  }
  if (path === "/api/players" && method === "POST") {
    requireAdmin(auth);
    const name = String(body?.name ?? "").trim();
    const note = cleanNote(body?.note);
    if (!name || name.length > 40) throw new HttpError(400, "Tên không hợp lệ.");
    const dup = await db.prepare("SELECT id FROM players WHERE name = ?").bind(name).first();
    if (dup) throw new HttpError(409, "Tên này đã có.");
    const color = cleanColor(body?.color);
    const r = await db.prepare("INSERT INTO players (name, note) VALUES (?, ?)").bind(name, note).run();
    const newId = Number(r.meta.last_row_id);
    if (color) await saveColor(db, newId, color);
    return json({ id: newId, name, note, color }, 201);
  }
  if ((m = path.match(/^\/api\/players\/(\d+)$/))) {
    requireAdmin(auth);
    const id = Number(m[1]);
    if (method === "PUT") {
      const name = String(body?.name ?? "").trim();
      const note = cleanNote(body?.note);
      if (!name || name.length > 40) throw new HttpError(400, "Tên không hợp lệ.");
      const dup = await db.prepare("SELECT id FROM players WHERE name = ? AND id <> ?").bind(name, id).first();
      if (dup) throw new HttpError(409, "Tên này đã có.");
      await db.prepare("UPDATE players SET name = ?, note = ? WHERE id = ?").bind(name, note, id).run();
      // Chỉ cập nhật màu khi client gửi trường color ("" = về màu mặc định)
      let color: string | null | undefined;
      if (body && "color" in body) {
        color = cleanColor(body.color);
        await saveColor(db, id, color);
      }
      return json({ id, name, note, color });
    }
    if (method === "DELETE") {
      const used = await db.prepare("SELECT 1 FROM results WHERE player_id = ? LIMIT 1").bind(id).first();
      if (used) throw new HttpError(409, "Cơ thủ đã có kết quả, không xoá được.");
      await db.prepare("DELETE FROM avatars WHERE player_id = ?").bind(id).run().catch(() => {});
      await db.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // --- giải ---
  if (path === "/api/sessions" && method === "GET") {
    const all = auth.isAdmin && new URL(req.url).searchParams.get("all") === "1";
    const { sessions, results } = await loadAll(db, all);
    return json(
      [...sessions].reverse().map((s) => ({ ...s, results: results.filter((r) => r.session_id === s.id) })),
    );
  }
  if (path === "/api/sessions" && method === "POST") {
    requireAdmin(auth);
    const ids = new Set((await db.prepare("SELECT id FROM players").all<{ id: number }>()).results.map((p) => p.id));
    const s = parseSession(body, ids);
    const who = auth.user?.username ?? String(auth.user?.id ?? "");
    const pub = body?.published ? 1 : 0;
    const r = await db
      .prepare("INSERT INTO sessions (date, created_by, published) VALUES (?, ?, ?)")
      .bind(s.date, who, pub)
      .run();
    const sid = r.meta.last_row_id;
    try {
      await db.batch(resultStmts(db, sid, s));
    } catch (e) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
      throw e;
    }
    return json({ id: sid }, 201);
  }
  if ((m = path.match(/^\/api\/sessions\/(\d+)\/publish$/)) && method === "POST") {
    requireAdmin(auth);
    const r = await db
      .prepare("UPDATE sessions SET published = ? WHERE id = ?")
      .bind(body?.published ? 1 : 0, Number(m[1]))
      .run();
    if (!r.meta.changes) throw new HttpError(404, "Không tìm thấy giải.");
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/sessions\/(\d+)$/))) {
    requireAdmin(auth);
    const id = Number(m[1]);
    const exists = await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(id).first();
    if (!exists) throw new HttpError(404, "Không tìm thấy giải.");
    if (method === "PUT") {
      const ids = new Set((await db.prepare("SELECT id FROM players").all<{ id: number }>()).results.map((p) => p.id));
      const s = parseSession(body, ids);
      await db.batch([
        body && "published" in body
          ? db.prepare("UPDATE sessions SET date = ?, published = ? WHERE id = ?").bind(s.date, body.published ? 1 : 0, id)
          : db.prepare("UPDATE sessions SET date = ? WHERE id = ?").bind(s.date, id),
        db.prepare("DELETE FROM results WHERE session_id = ?").bind(id),
        ...resultStmts(db, id, s),
      ]);
      return json({ id });
    }
    if (method === "DELETE") {
      await db.batch([
        db.prepare("DELETE FROM results WHERE session_id = ?").bind(id),
        db.prepare("DELETE FROM sessions WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if (path === "/api/export" && method === "GET") {
    requireAdmin(auth);
    return json({ exported_at: new Date().toISOString(), ...(await loadAll(db, true)) });
  }

  throw new HttpError(404, "Không có API này.");
}

// ---------- bot ----------
function textTable(rows: Row[]): string {
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
  const marks = new Map<number, number>();
  rows.filter((r) => r.note).forEach((r, i) => marks.set(r.player_id, i + 1));
  const lines = rows.map((r) => {
    const mark = r.rank_delta ? (r.rank_delta > 0 ? `▲${r.rank_delta}` : `▼${-r.rank_delta}`) : "";
    const up = r.points_delta ? ` +${r.points_delta}` : "";
    const name = r.name + (marks.has(r.player_id) ? `(${marks.get(r.player_id)})` : "");
    return `${lpad(String(r.rank), 2)} ${pad(name, 9)}${lpad(String(r.points), 4)}${pad(up, 4)} ${lpad(
      String(r.win),
      3,
    )}-${pad(String(r.lose), 3)} ${mark}`;
  });
  const notes = rows
    .filter((r) => r.note)
    .flatMap((r) => [`(${marks.get(r.player_id)}): ${r.name}`, ...r.note!.split("\n").map((l) => `  • ${l}`)]);
  return ["#  Cơ thủ    Pts      W-L", ...lines, ...(notes.length ? ["", ...notes] : [])].join("\n");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function bot(req: Request, env: Env, url: URL): Promise<Response> {
  const token = env.BOT_TOKEN;
  if (!token) return new Response("Thiếu BOT_TOKEN", { status: 500 });

  // Mở 1 lần trên trình duyệt để đăng ký webhook + nút menu:
  // https://<worker>/bot/setup?key=<WEBHOOK_SECRET>
  if (url.pathname === "/bot/setup") {
    if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) {
      return new Response("Sai key", { status: 403 });
    }
    const appUrl = url.origin + "/";
    const results = {
      setWebhook: await tgCall(token, "setWebhook", {
        url: url.origin + "/bot/webhook",
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message"],
      }),
      setChatMenuButton: await tgCall(token, "setChatMenuButton", {
        menu_button: { type: "web_app", text: "Bảng xếp hạng", web_app: { url: appUrl } },
      }),
      setMyCommands: await tgCall(token, "setMyCommands", {
        commands: [
          { command: "bxh", description: "Xem bảng xếp hạng" },
          { command: "start", description: "Mở app tính điểm" },
        ],
      }),
    };
    return json(results);
  }

  if (url.pathname === "/bot/webhook" && req.method === "POST") {
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update: any = await req.json().catch(() => ({}));
    const msg = update.message;
    const text: string = msg?.text ?? "";
    const chatId = msg?.chat?.id;
    if (!chatId) return new Response("ok");
    const cmd = text.split(/[\s@]/)[0];

    if (cmd === "/bxh") {
      const { rows, latest } = await leaderboard(env);
      const head = latest ? `🎱 <b>BẢNG XẾP HẠNG</b> (sau giải ${latest.date})\n` : "🎱 <b>BẢNG XẾP HẠNG</b>\n";
      await tgCall(token, "sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: rows.length ? head + "<pre>" + escapeHtml(textTable(rows)) + "</pre>" : "Chưa có dữ liệu.",
      });
    } else if (cmd === "/start") {
      const isPrivate = msg.chat.type === "private";
      await tgCall(token, "sendMessage", {
        chat_id: chatId,
        text: "🎱 App tính điểm bida. Gõ /bxh để xem nhanh bảng xếp hạng.",
        // Nút web_app chỉ dùng được trong chat riêng với bot.
        reply_markup: isPrivate
          ? { inline_keyboard: [[{ text: "Mở bảng xếp hạng", web_app: { url: url.origin + "/" } }]] }
          : undefined,
      });
    }
    return new Response("ok");
  }

  return new Response("Not found", { status: 404 });
}

// ---------- entry ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, env, url.pathname);
      if (url.pathname.startsWith("/bot/")) return await bot(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Lỗi máy chủ: " + (e as Error).message }, 500);
    }
  },
};
