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

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;

// ---------- truy vấn ----------
async function loadAll(db: D1Database) {
  const [p, s, r] = await Promise.all([
    db.prepare("SELECT id, name, note FROM players ORDER BY id").all<Player>(),
    db.prepare("SELECT id, date FROM sessions ORDER BY date, id").all<Session>(),
    db.prepare("SELECT session_id, player_id, type, win, lose, rank FROM results").all<Result>(),
  ]);
  return { players: p.results, sessions: s.results, results: r.results };
}

async function leaderboard(env: Env) {
  const { players, sessions, results } = await loadAll(env.DB);
  return {
    rows: computeLeaderboard(players, sessions, results),
    latest: sessions[sessions.length - 1] ?? null,
    sessionCount: sessions.length,
  };
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
    return json({ user: auth.user, isAdmin: auth.isAdmin });
  }
  if (path === "/api/leaderboard" && method === "GET") {
    return json(await leaderboard(env));
  }

  // --- cơ thủ ---
  if (path === "/api/players" && method === "GET") {
    return json((await db.prepare("SELECT id, name, note FROM players ORDER BY name").all()).results);
  }
  if (path === "/api/players" && method === "POST") {
    requireAdmin(auth);
    const name = String(body?.name ?? "").trim();
    const note = cleanNote(body?.note);
    if (!name || name.length > 40) throw new HttpError(400, "Tên không hợp lệ.");
    const dup = await db.prepare("SELECT id FROM players WHERE name = ?").bind(name).first();
    if (dup) throw new HttpError(409, "Tên này đã có.");
    const r = await db.prepare("INSERT INTO players (name, note) VALUES (?, ?)").bind(name, note).run();
    return json({ id: r.meta.last_row_id, name, note }, 201);
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
      return json({ id, name, note });
    }
    if (method === "DELETE") {
      const used = await db.prepare("SELECT 1 FROM results WHERE player_id = ? LIMIT 1").bind(id).first();
      if (used) throw new HttpError(409, "Cơ thủ đã có kết quả, không xoá được.");
      await db.prepare("DELETE FROM players WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // --- giải ---
  if (path === "/api/sessions" && method === "GET") {
    const { sessions, results } = await loadAll(db);
    return json(
      [...sessions].reverse().map((s) => ({ ...s, results: results.filter((r) => r.session_id === s.id) })),
    );
  }
  if (path === "/api/sessions" && method === "POST") {
    requireAdmin(auth);
    const ids = new Set((await db.prepare("SELECT id FROM players").all<{ id: number }>()).results.map((p) => p.id));
    const s = parseSession(body, ids);
    const who = auth.user?.username ?? String(auth.user?.id ?? "");
    const r = await db.prepare("INSERT INTO sessions (date, created_by) VALUES (?, ?)").bind(s.date, who).run();
    const sid = r.meta.last_row_id;
    try {
      await db.batch(resultStmts(db, sid, s));
    } catch (e) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
      throw e;
    }
    return json({ id: sid }, 201);
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
        db.prepare("UPDATE sessions SET date = ? WHERE id = ?").bind(s.date, id),
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
    return json({ exported_at: new Date().toISOString(), ...(await loadAll(db)) });
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
