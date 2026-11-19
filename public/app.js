"use strict";

const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;
if (tg) {
  tg.ready();
  tg.expand();
  if (inTelegram) document.documentElement.classList.add("tg");
  if (inTelegram && ["tdesktop", "macos", "weba", "webk", "unigram"].includes(tg.platform)) {
    document.documentElement.classList.add("desk");
  }
  // Toàn màn hình trên điện thoại (Telegram 8.0+)
  const mobile = ["android", "ios"].includes(tg.platform);
  if (mobile && tg.isVersionAtLeast?.("8.0") && !tg.isFullscreen) {
    try { tg.requestFullscreen(); } catch {}
  }
  // Chừa chỗ cho tai thỏ + nút Close/menu của Telegram khi toàn màn hình
  const applyInsets = () => {
    const s = tg.safeAreaInset || {};
    const c = tg.contentSafeAreaInset || {};
    const top = (s.top || 0) + (c.top || 0);
    const bottom = (s.bottom || 0) + (c.bottom || 0);
    document.body.style.paddingTop =
      top > 0 ? top + "px" : tg.isFullscreen ? "calc(env(safe-area-inset-top, 44px) + 56px)" : "";
    document.body.style.paddingBottom = 24 + bottom + "px";
  };
  applyInsets();
  ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"].forEach((ev) => {
    try { tg.onEvent(ev, applyInsets); } catch {}
  });
}

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { isAdmin: false, players: [], sessions: [], editingId: null };

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": tg?.initData ?? "",
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function confirmBox(msg) {
  return new Promise((resolve) => {
    if (inTelegram && tg.showConfirm) tg.showConfirm(msg, resolve);
    else resolve(window.confirm(msg));
  });
}

function haptic(type = "success") {
  try { tg?.HapticFeedback?.notificationOccurred(type); } catch {}
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "tab-" + name));
  if (name === "board") loadBoard();
  if (name === "podium") loadPodium();
  if (name === "achv") loadAchievements();
  if (name === "chart") loadCharts();
  if (name === "sessions") loadSessions();
  if (name === "entry" && state.editingId == null) resetEntry();
  if (name === "players") {
    renderPlayers();
    loadVisitors();
  }
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});

// ---------- bảng xếp hạng ----------
// Chỉ hiện hạng của 3 giải gần nhất
const RANK_HISTORY = 3;
const badges = (ranks) =>
  ranks.slice(0, RANK_HISTORY).map((r) => `<span class="r r${Math.min(r, 4)}">${r}</span>`).join("");
const rateCls = (v) => (v >= 60 ? "hi" : v >= 50 ? "mid" : v >= 40 ? "lo" : "bad");
const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "");

async function loadBoard() {
  const lb = $("#lb");
  try {
    const { rows, latest, sessionCount } = await api("/api/leaderboard");
    $("#board-sub").textContent = latest ? `Sau ${sessionCount} giải · gần nhất ${fmtDate(latest.date)}` : "Chưa có giải nào.";

    // Ký hiệu ghi chú: (*), (**), ...
    const marks = new Map();
    rows.filter((r) => r.note).forEach((r, i) => marks.set(r.player_id, `(${i + 1})`));

    const rankMark = (r) =>
      r.rank_delta > 0 ? `<span class="ru">▲${r.rank_delta}</span>` : r.rank_delta < 0 ? `<span class="rd">▼${-r.rank_delta}</span>` : "";
    const ptsMark = (r) => (r.points_delta > 0 ? `<td class="up">▲${r.points_delta}</td>` : `<td class="z">${r.points_delta == null ? "" : "–"}</td>`);

    lb.innerHTML = `
      <thead>
        <tr class="grp">
          <th colspan="6"></th>
          <th colspan="4" class="g lg">League</th>
          <th colspan="4" class="g cp">Cup</th>
          <th colspan="2" class="g pt">Total</th>
        </tr>
        <tr>
        <th>Total<br>Rank</th><th class="n">Player</th><th>Game<br>Play</th><th>Win</th><th>Lose</th><th>Win<br>%</th>
        <th class="g lg">Play</th><th class="lg">Win</th><th class="lg">Rank</th><th class="lg">Pts</th>
        <th class="g cp">Play</th><th class="cp">Win</th><th class="cp">Rank</th><th class="cp">Pts</th><th class="g pt">Pts</th><th class="pt"></th>
      </tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr class="${r.rank <= 3 ? "medal m" + r.rank : ""}">
        <td><span class="tr tr${Math.min(r.rank, 4)}">${r.rank}</span></td>
        <td class="n">${esc(r.name)}${marks.has(r.player_id) ? ` <span class="mk">${marks.get(r.player_id)}</span>` : ""}${rankMark(r)}</td>
        <td>${r.games}</td><td class="w">${r.win}</td><td class="l">${r.lose}</td><td><span class="wr ${rateCls(r.win_rate)}">${r.win_rate.toFixed(1)}</span></td>
        <td class="g lg">${r.league_played}</td><td class="lg">${r.league_win || "·"}</td><td class="rk lg">${badges(r.league_ranks)}</td><td class="lg b">${r.league_pts}</td>
        <td class="g cp">${r.cup_played}</td><td class="cp">${r.cup_win || "·"}</td><td class="rk cp">${badges(r.cup_ranks)}</td><td class="cp b">${r.cup_pts}</td>
        <td class="g p pt"><span class="pts">${r.points}</span></td>${ptsMark(r).replace("<td class=\"", "<td class=\"pt ")}
      </tr>`,
        )
        .join("")}</tbody>`;

    const notes = rows
      .filter((r) => r.note)
      .map(
        (r) =>
          `<div class="pn"><span class="pn-k">${marks.get(r.player_id)}:</span><ul>${r.note
            .split("\n")
            .map((l) => `<li>${esc(l)}</li>`)
            .join("")}</ul></div>`,
      );
    const sec = (title, lines) =>
      `<div class="note-sec"><div class="note-h">${title}</div>${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
    $("#lb-note").innerHTML = [
      sec("Cách tính điểm", [
        "Thắng 1 trận: +1",
        `Hạng League / Cup:<ul class="note-ul"><li>Top 1 +3</li><li>Top 2 +2</li><li>Top 3 +1</li><li>Top 4 +0</li></ul>`,
        "<b>Pts = Win + League Pts + Cup Pts</b>",
      ]),
      notes.length ? sec("Ghi chú", notes) : "",
    ].join("");
  } catch (e) {
    lb.innerHTML = "";
    $("#board-sub").textContent = "Không tải được: " + e.message;
  }
}

// ---------- bục vinh danh ----------
// Ảnh đại diện admin tải lên trong tab Cơ thủ (lưu trong D1). Chưa có ảnh thì hiện chữ cái đầu của tên.
function avatarUrl(id, name, version) {
  return version ? `/api/avatar/${id}?v=${encodeURIComponent(version)}` : null;
}
function avatarHtml(id, name, version, cls = "") {
  const url = avatarUrl(id, name, version);
  return url
    ? `<img class="av ${cls}" src="${url}" alt="${esc(name)}" />`
    : `<div class="av av-txt ${cls}">${esc(name.charAt(0))}</div>`;
}

// Đương kim vô địch: bục League và bục Cup của giải gần nhất có thể thức đó
async function loadPodium() {
  const box = $("#podium");
  try {
    const [sessions, players] = await Promise.all([api("/api/sessions"), loadPlayers()]);
    const pl = new Map(players.map((p) => [p.id, p]));
    const person = (id) => pl.get(id) ?? { id, name: "?", avatar_v: null };
    const av = (id, cls = "") => avatarHtml(id, person(id).name, person(id).avatar_v, cls);

    // sessions đã sắp mới nhất trước
    const lastLeague = sessions.find((s) => s.results.some((r) => r.type === "LEAGUE"));
    const lastCup = sessions.find((s) => s.results.some((r) => r.type === "CUP"));
    if (!lastLeague && !lastCup) return (box.innerHTML = `<p class="hint">Chưa có giải nào.</p>`);

    const leagueEntries = (s) => {
      const list = s.results.filter((r) => r.type === "LEAGUE").sort((a, b) => b.win - a.win);
      const ranks = denseRanks(list.map((r) => r.win));
      return list.map((r, i) => ({ ...r, rank: ranks[i] }));
    };
    const cupEntries = (s) => s.results.filter((r) => r.type === "CUP").sort((a, b) => a.rank - b.rank);

    const stage = (title, cls, s, entries) => {
      if (!s) return "";
      const byRank = (k) => entries.filter((e) => e.rank === k);
      const fig = (e) =>
        `<div class="fig">${av(e.player_id)}<div class="fig-n">${esc(person(e.player_id).name)}</div><div class="fig-p">${e.win}-${e.lose}</div></div>`;
      const step = (k) => {
        const list = byRank(k);
        return `<div class="col col-${k}">
          <div class="figs">${k === 1 && list.length ? '<div class="crown">🏆</div>' : ""}${list.map(fig).join("")}</div>
          <div class="step step-${k}"><span>${k}</span></div>
        </div>`;
      };
      const rest = entries.filter((e) => e.rank > 3);
      return `<div class="champ ${cls}">
        <div class="champ-h"><span class="champ-t">${title}</span><span class="champ-d">Giải ${fmtDate(s.date)}</span></div>
        <div class="stage">${step(2)}${step(1)}${step(3)}</div>
        ${rest.length ? `<div class="rest">${rest
          .map((e) => `<div class="rest-i"><span class="rest-k">${e.rank}</span>${av(e.player_id, "sm")}<span class="rest-n">${esc(person(e.player_id).name)}</span><span class="rest-p">${e.win}-${e.lose}</span></div>`)
          .join("")}</div>` : ""}
      </div>`;
    };

    box.innerHTML =
      stage("League", "champ-l", lastLeague, lastLeague ? leagueEntries(lastLeague) : []) +
      stage("Cup", "champ-c", lastCup, lastCup ? cupEntries(lastCup) : []);
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

// ---------- thành tích ----------
// Khung thẻ vẽ sẵn theo hạng; toạ độ các ô (px trên ảnh gốc): [x1, y1, x2, y2]
const FRAMES = {
  1: { f: "platinum", w: 241, h: 491, pb: 20, name: [42, 150, 208, 182], img: [46, 204, 200, 374], box: [40, 392, 208, 452] },
  2: { f: "gold", w: 191, h: 460, pb: 3, name: [22, 140, 168, 176], img: [24, 190, 168, 360], box: [18, 380, 174, 446] },
  3: { f: "silver", w: 186, h: 440, pb: 2, name: [22, 124, 164, 158], img: [22, 172, 164, 344], box: [16, 362, 168, 424] },
  4: { f: "bronze", w: 188, h: 436, pb: 4, name: [22, 116, 168, 150], img: [22, 164, 168, 340], box: [16, 360, 170, 422] },
  5: { f: "wood", w: 185, h: 420, pb: 2, name: [22, 102, 168, 138], img: [22, 154, 168, 320], box: [16, 340, 168, 404] },
};
function slotStyle(fr, [x1, y1, x2, y2]) {
  const p = (v, t) => ((v / t) * 100).toFixed(2) + "%";
  return `left:${p(x1, fr.w)};top:${p(y1, fr.h)};width:${p(x2 - x1, fr.w)};height:${p(y2 - y1, fr.h)}`;
}
// Mỗi lần vô địch League hoặc Cup = 1 sao vàng. Top 1 platinum, 2 gold, 3 silver, 4 bronze, 5+ (hoặc 0 sao) wood
async function loadAchievements() {
  const box = $("#achv");
  try {
    const { rows, avatars = {} } = await api("/api/leaderboard");
    const list = rows
      .map((r) => ({ ...r, stars: r.league_win + r.cup_win }))
      .sort((a, b) => b.stars - a.stars || b.league_win - a.league_win || a.rank - b.rank);
    const ranks = denseRanks(list.map((r) => r.stars));
    box.innerHTML = list
      .map((r, i) => {
        const tier = r.stars ? Math.min(ranks[i], 5) : 5;
        const fr = FRAMES[tier];
        const stars = r.stars ? "★".repeat(r.stars) : "☆";
        const detail =
          (r.league_win ? `<span class="tag tag-l">League ×${r.league_win}</span>` : "") +
          (r.cup_win ? `<span class="tag tag-c">Cup ×${r.cup_win}</span>` : "");
        return `<div class="ach ach-t${tier} ${r.stars ? "" : "ach-0"}">
          <div class="ach-fr" style="--fw:${fr.w};--fh:${fr.h};--pb:${fr.pb};background-image:url(img/frames/${fr.f}.png)" aria-label="Top ${ranks[i]}">
            <div class="ach-img" style="${slotStyle(fr, fr.img)}">${avatarHtml(r.player_id, r.name, avatars[r.player_id], "ach-av")}</div>
            <div class="ach-rib" style="${slotStyle(fr, fr.name)}"><span>${esc(r.name)}</span></div>
            <div class="ach-box" style="${slotStyle(fr, fr.box)}">
              <div class="ach-s">${stars}</div>
              <div class="ach-d">${detail}</div>
            </div>
          </div>
        </div>`;
      })
      .join("");
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

// ---------- biểu đồ ----------
// Đường thể hiện hạng League / Cup của từng cơ thủ trong 10 giải gần nhất (có thể thức đó).
const CHART_N = 10;
// Màu riêng theo tên cơ thủ (so khớp không dấu); người khác lấy lần lượt màu dự phòng
const PLAYER_COLORS = { huu: "red", loan: "white", an: "green", chang: "blue", duc: "orange" };
const SPARE_COLORS = ["violet", "pink", "yellow", "aqua"];
const normName = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const chartState = { hl: null, data: null };

const isDark = () =>
  inTelegram ? tg.colorScheme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;

async function loadCharts() {
  const box = $("#charts");
  try {
    const [sessions, players] = await Promise.all([api("/api/sessions"), loadPlayers()]);
    document.documentElement.classList.toggle("dark", !!isDark());
    // Màu gắn theo cơ thủ (thứ tự id), không đổi giữa 2 biểu đồ
    const ordered = [...players].sort((a, b) => a.id - b.id);
    let spare = 0;
    const color = new Map(
      ordered.map((p) => {
        const c = PLAYER_COLORS[normName(p.name)] ?? SPARE_COLORS[spare++] ?? "gray";
        return [p.id, c];
      }),
    );
    const name = (id) => players.find((p) => p.id === id)?.name ?? "?";

    const pick = (type) => {
      // sessions mới nhất trước -> lấy 10 giải gần nhất có thể thức này, đảo lại cũ -> mới
      const list = sessions.filter((s) => s.results.some((r) => r.type === type)).slice(0, CHART_N).reverse();
      return list.map((s) => {
        let rows = s.results.filter((r) => r.type === type);
        if (type === "LEAGUE") {
          rows = rows.sort((a, b) => b.win - a.win);
          const rk = denseRanks(rows.map((r) => r.win));
          rows = rows.map((r, i) => ({ ...r, rank: rk[i] }));
        } else rows = rows.sort((a, b) => a.rank - b.rank);
        return { date: s.date, rows };
      });
    };
    const league = pick("LEAGUE");
    const cup = pick("CUP");
    const ids = new Set([...league, ...cup].flatMap((s) => s.rows.map((r) => r.player_id)));
    const series = ordered.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, name: p.name, av: p.avatar_v, c: color.get(p.id), color: `var(--pc-${color.get(p.id)})` }));
    chartState.data = { league, cup, series, name };

    if (!series.length) {
      $("#chart-legend").innerHTML = "";
      box.innerHTML = `<p class="hint">Chưa có giải nào.</p>`;
      return;
    }
    renderCharts();
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function renderCharts() {
  const { league, cup, series } = chartState.data;
  $("#chart-legend").innerHTML = series
    .map(
      (p) => `<button type="button" class="ch-key ${chartState.hl == null ? "" : chartState.hl === p.id ? "on" : "off"}" data-hl="${p.id}">
        <span class="ch-key-av pc-${p.c}" style="--c:${p.color}">${avatarHtml(p.id, p.name, p.av, "sm")}</span>${esc(p.name)}</button>`,
    )
    .join("");
  $("#charts").innerHTML =
    rankChart("League", "lg", league, series) + rankChart("Cup", "cp", cup, series);
}

function rankChart(title, key, sessions, series) {
  if (!sessions.length) return `<div class="ch-card"><div class="ch-h">${title}</div><p class="hint">Chưa có giải ${title}.</p></div>`;
  const W = 360, H = 230, L = 26, R = 30, T = 16, B = 26;
  const maxRank = Math.max(4, ...sessions.flatMap((s) => s.rows.map((r) => r.rank)));
  const n = sessions.length;
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (r) => T + ((r - 1) * (H - T - B)) / (maxRank - 1);

  // Người đồng hạng trong cùng 1 giải: tách nhẹ theo chiều dọc để đường không chồng khít
  const pos = new Map(); // `${i}:${pid}` -> [x, y, row]
  sessions.forEach((s, i) => {
    const byRank = new Map();
    s.rows.forEach((r) => byRank.set(r.rank, [...(byRank.get(r.rank) || []), r]));
    byRank.forEach((list, rank) => {
      list.sort((a, b) => a.player_id - b.player_id).forEach((r, k) => {
        const off = (k - (list.length - 1) / 2) * 5;
        pos.set(`${i}:${r.player_id}`, [x(i), y(rank) + off, r]);
      });
    });
  });

  const grid = Array.from({ length: maxRank }, (_, k) => k + 1)
    .map((r) => `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}"/><text class="ch-ax" x="${L - 8}" y="${y(r) + 3.5}" text-anchor="end">${r}</text>`)
    .join("");
  const step = n > 6 ? 2 : 1; // màn hẹp: nhãn ngày cách 1
  const xlab = sessions
    .map((s, i) => ((n - 1 - i) % step === 0 ? `<text class="ch-ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDate(s.date).slice(0, 5)}</text>` : ""))
    .join("");

  const hl = chartState.hl;
  const lines = series
    .map((p) => {
      const pts = sessions.map((_, i) => pos.get(`${i}:${p.id}`));
      if (!pts.some(Boolean)) return "";
      // Vắng mặt ở giải nào thì ngắt đường ở đó
      let d = "", pen = false;
      pts.forEach((pt) => {
        if (!pt) return (pen = false);
        d += `${pen ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;
        pen = true;
      });
      const dots = pts
        .filter(Boolean)
        .map((pt) => `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="4"/>`)
        .join("");
      const cls = hl == null ? "" : hl === p.id ? "hl" : "dim";
      return `<g class="ch-s pc-${p.c} ${cls}" style="--c:${p.color}"><path class="case" d="${d}"/><path d="${d}"/>${dots}</g>`;
    })
    .join("");
  // Đưa đường đang chọn lên trên cùng
  const ordered = hl == null ? lines : lines.replace(/<g class="ch-s hl"[\s\S]*?<\/g>/, "") + (lines.match(/<g class="ch-s hl"[\s\S]*?<\/g>/)?.[0] ?? "");

  // Ảnh cơ thủ đặt ở điểm cuối của đường; ai trùng điểm cuối thì xếp ngang cạnh nhau
  const lastGroups = new Map();
  series.forEach((p) => {
    for (let i = n - 1; i >= 0; i--) {
      const pt = pos.get(`${i}:${p.id}`);
      if (!pt) continue;
      const k = `${i}:${pt[2].rank}`;
      lastGroups.set(k, [...(lastGroups.get(k) || []), { p, i, rank: pt[2].rank }]);
      break;
    }
  });
  const AV = 11;
  let avs = "";
  lastGroups.forEach((list) => {
    list.forEach(({ p, i, rank }, k) => {
      let ax = x(i) + (k - (list.length - 1) / 2) * (AV * 2 + 2);
      ax = Math.min(ax, W - AV - 1);
      const ay = y(rank);
      const cid = `cl-${key}-${p.id}`;
      const url = avatarUrl(p.id, p.name, p.av);
      const inner = url
        ? `<clipPath id="${cid}"><circle cx="${ax}" cy="${ay}" r="${AV - 1.5}"/></clipPath><image href="${url}" x="${ax - AV}" y="${ay - AV}" width="${AV * 2}" height="${AV * 2}" clip-path="url(#${cid})" preserveAspectRatio="xMidYMid slice"/>`
        : `<text x="${ax}" y="${ay + 4}" text-anchor="middle" class="ch-av-t">${esc(p.name.charAt(0))}</text>`;
      const cls = hl == null ? "" : hl === p.id ? "hl" : "dim";
      avs += `<g class="ch-av pc-${p.c} ${cls} ${url ? "" : "noimg"}" style="--c:${p.color}"><circle class="ring" cx="${ax}" cy="${ay}" r="${AV}"/>${inner}</g>`;
    });
  });

  const colW = n === 1 ? W - L - R : (W - L - R) / (n - 1);
  const hits = sessions
    .map((_, i) => `<rect class="ch-hit" data-i="${i}" x="${x(i) - colW / 2}" y="0" width="${colW}" height="${H}"/>`)
    .join("");

  return `<div class="ch-card" data-chart="${key}">
    <div class="ch-h"><span>${title}</span><span class="hint">${n} giải gần nhất</span></div>
    <div class="ch-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="ch" role="img" aria-label="Biểu đồ hạng ${title}">
        ${grid}${xlab}<line class="ch-cross" x1="0" x2="0" y1="${T - 6}" y2="${H - B + 4}" hidden/>${ordered}${avs}${hits}
      </svg>
      <div class="ch-tip" hidden></div>
    </div>
  </div>`;
}

$("#chart-legend").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hl]");
  if (!b) return;
  const id = Number(b.dataset.hl);
  chartState.hl = chartState.hl === id ? null : id;
  renderCharts();
});

// Chạm / rê chuột vào cột giải: hiện đường dóng + bảng hạng của giải đó
function showChartTip(e) {
  const hit = e.target.closest?.(".ch-hit");
  const card = e.target.closest?.(".ch-card");
  if (!hit || !card) return;
  const { league, cup, series, name } = chartState.data;
  const sessions = card.dataset.chart === "lg" ? league : cup;
  const i = Number(hit.dataset.i);
  const s = sessions[i];
  const svg = card.querySelector("svg");
  const cross = svg.querySelector(".ch-cross");
  const cx = Number(hit.getAttribute("x")) + Number(hit.getAttribute("width")) / 2;
  cross.setAttribute("x1", cx);
  cross.setAttribute("x2", cx);
  cross.hidden = false;
  const col = new Map(series.map((p) => [p.id, p.color]));
  const tip = card.querySelector(".ch-tip");
  tip.innerHTML =
    `<div class="ch-tip-h">Giải ${fmtDate(s.date)}</div>` +
    s.rows
      .map(
        (r) => `<div class="ch-tip-r ${chartState.hl === r.player_id ? "on" : ""}"><span class="r r${Math.min(r.rank, 4)}">${r.rank}</span>
        <i style="background:${col.get(r.player_id)}"></i><span class="ch-tip-n">${esc(name(r.player_id))}</span><span class="ch-tip-v">${r.win}-${r.lose}</span></div>`,
      )
      .join("");
  tip.hidden = false;
  // Đặt tooltip bên phải đường dóng, sát mép thì lật sang trái
  const wrap = card.querySelector(".ch-wrap");
  const px = (cx / svg.viewBox.baseVal.width) * wrap.clientWidth;
  const left = px + 12 + tip.offsetWidth > wrap.clientWidth ? px - 12 - tip.offsetWidth : px + 12;
  tip.style.left = Math.max(0, left) + "px";
}
function hideChartTip(card) {
  if (!card) return;
  card.querySelector(".ch-tip").hidden = true;
  card.querySelector(".ch-cross").hidden = true;
}
$("#charts").addEventListener("pointermove", showChartTip);
$("#charts").addEventListener("click", showChartTip);
$("#charts").addEventListener("pointerout", (e) => {
  if (e.pointerType !== "mouse") return;
  const wrap = e.target.closest?.(".ch-wrap");
  if (wrap && !wrap.contains(e.relatedTarget)) hideChartTip(wrap.closest(".ch-card"));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".ch-wrap")) document.querySelectorAll(".ch-card").forEach(hideChartTip);
});

// ---------- các giải ----------
// Bảng kết quả 1 thể thức trong 1 giải
function resTable(title, cls, list, name) {
  return `<table class="res res-${cls}">
    <thead><tr><th colspan="4" class="res-t">${title}</th></tr>
      <tr><th>Hạng</th><th class="n">Cơ thủ</th><th>Thắng</th><th>Thua</th></tr></thead>
    <tbody>${list
      .map(
        (r) => `<tr><td><span class="r r${Math.min(r.rank, 4)}">${r.rank}</span></td><td class="n">${esc(name(r.player_id))}</td>
        <td class="w">${r.win}</td><td class="l">${r.lose}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

async function loadSessions() {
  const box = $("#session-list");
  try {
    [state.sessions] = await Promise.all([api("/api/sessions"), loadPlayers()]);
    const name = (id) => state.players.find((p) => p.id === id)?.name ?? "?";
    if (!state.sessions.length) {
      box.innerHTML = `<p class="hint">Chưa có giải nào.</p>`;
      return;
    }
    box.innerHTML = state.sessions
      .map((s, i) => {
        const league = s.results.filter((r) => r.type === "LEAGUE").sort((a, b) => b.win - a.win);
        const ranks = denseRanks(league.map((r) => r.win));
        const cup = s.results.filter((r) => r.type === "CUP").sort((a, b) => a.rank - b.rank);
        return `<div class="card">
          <h3><span>Giải ${state.sessions.length - i} · ${fmtDate(s.date)}</span>
            <span class="btns admin-only">
              <button class="mini" data-edit="${s.id}">Sửa</button>
              <button class="mini danger" data-del="${s.id}">Xoá</button>
            </span></h3>
          <div class="res-wrap">
            ${league.length ? resTable("League", "lg", league.map((r, j) => ({ ...r, rank: ranks[j] })), name) : ""}
            ${cup.length ? resTable("Cup", "cp", cup, name) : ""}
          </div>
        </div>`;
      })
      .join("");
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

$("#session-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-del]");
  if (edit) {
    const s = state.sessions.find((x) => x.id === Number(edit.dataset.edit));
    if (s) startEdit(s);
  }
  if (del) {
    const s = state.sessions.find((x) => x.id === Number(del.dataset.del));
    if (!(await confirmBox(`Xoá giải ${fmtDate(s?.date)}? Không hoàn tác được.`))) return;
    try {
      await api(`/api/sessions/${del.dataset.del}`, { method: "DELETE" });
      haptic();
      toast("Đã xoá");
      loadSessions();
    } catch (err) {
      toast(err.message);
    }
  }
});

function denseRanks(sortedDesc) {
  let rank = 0, prev;
  return sortedDesc.map((v) => (v !== prev ? ((prev = v), ++rank) : rank));
}

// ---------- nhập giải ----------
const CUP_DEFAULT = { 1: [2, 0], 2: [1, 1], 3: [1, 1] };

function renderEntryRows(existing) {
  const players = [...state.players].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const get = (type, id) => existing?.find((r) => r.type === type && r.player_id === id);
  const n = players.length;

  $("#league-rows").innerHTML =
    `<div></div><div class="h">Thắng</div><div class="h">Thua</div><div class="h">Hạng</div>` +
    players
      .map((p) => {
        const r = get("LEAGUE", p.id);
        return `<div class="nm">${esc(p.name)}</div>
        <input type="number" inputmode="numeric" min="0" max="999" data-l-win="${p.id}" value="${r ? r.win : ""}" />
        <input type="number" inputmode="numeric" min="0" max="999" data-l-lose="${p.id}" value="${r ? r.lose : ""}" />
        <div class="rk" data-l-rank="${p.id}"></div>`;
      })
      .join("");

  const opts = (sel) =>
    `<option value="">–</option>` +
    Array.from({ length: Math.max(4, n) }, (_, i) => `<option value="${i + 1}" ${sel === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("");
  $("#cup-rows").innerHTML =
    `<div></div><div class="h">Hạng</div><div class="h">Thắng</div><div class="h">Thua</div>` +
    players
      .map((p) => {
        const r = get("CUP", p.id);
        return `<div class="nm">${esc(p.name)}</div>
        <select data-c-rank="${p.id}">${opts(r?.rank)}</select>
        <input type="number" inputmode="numeric" min="0" max="999" data-c-win="${p.id}" value="${r ? r.win : ""}" />
        <input type="number" inputmode="numeric" min="0" max="999" data-c-lose="${p.id}" value="${r ? r.lose : ""}" />`;
      })
      .join("");
  updateLeaguePreview();
}

function updateLeaguePreview() {
  const entries = [...document.querySelectorAll("[data-l-win]")]
    .map((el) => ({ id: el.dataset.lWin, win: el.value === "" ? null : Number(el.value) }))
    .filter((x) => x.win != null);
  const sorted = [...entries].sort((a, b) => b.win - a.win);
  const ranks = denseRanks(sorted.map((x) => x.win));
  document.querySelectorAll("[data-l-rank]").forEach((el) => (el.textContent = ""));
  sorted.forEach((x, i) => {
    const el = document.querySelector(`[data-l-rank="${x.id}"]`);
    if (el) el.textContent = ranks[i];
  });
  $("#league-preview").textContent = entries.length ? "Hạng League tự tính theo số trận thắng, bằng nhau thì đồng hạng." : "";
}

$("#league-rows").addEventListener("input", updateLeaguePreview);
$("#cup-rows").addEventListener("change", (e) => {
  const id = e.target.dataset.cRank;
  if (!id) return;
  const rank = Number(e.target.value);
  const [w, l] = rank ? CUP_DEFAULT[rank] ?? [0, 2] : ["", ""];
  document.querySelector(`[data-c-win="${id}"]`).value = w;
  document.querySelector(`[data-c-lose="${id}"]`).value = l;
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function resetEntry() {
  state.editingId = null;
  $("#entry-cancel").hidden = true;
  $("#entry-submit").textContent = "Lưu giải";
  $("#entry-err").textContent = "";
  $("#date").value = todayStr();
  await loadPlayers();
  renderEntryRows(null);
}

async function startEdit(s) {
  state.editingId = s.id;
  await loadPlayers();
  showTab("entry");
  $("#entry-cancel").hidden = false;
  $("#entry-submit").textContent = "Cập nhật giải";
  $("#entry-err").textContent = "";
  $("#date").value = s.date;
  renderEntryRows(s.results);
}
$("#entry-cancel").addEventListener("click", () => {
  resetEntry();
  showTab("sessions");
});

function readEntry() {
  const num = (el) => (el.value === "" ? null : Number(el.value));
  const league = [];
  for (const p of state.players) {
    const w = num(document.querySelector(`[data-l-win="${p.id}"]`));
    const l = num(document.querySelector(`[data-l-lose="${p.id}"]`));
    if (w == null && l == null) continue;
    if (w == null || l == null) throw new Error(`League: ${p.name} cần nhập đủ thắng và thua.`);
    league.push({ player_id: p.id, win: w, lose: l });
  }
  const cup = [];
  for (const p of state.players) {
    const rank = num(document.querySelector(`[data-c-rank="${p.id}"]`));
    if (rank == null) continue;
    const w = num(document.querySelector(`[data-c-win="${p.id}"]`));
    const l = num(document.querySelector(`[data-c-lose="${p.id}"]`));
    cup.push({ player_id: p.id, rank, win: w ?? undefined, lose: l ?? undefined });
  }
  if (!league.length && !cup.length) throw new Error("Chưa nhập kết quả nào.");
  return { date: $("#date").value, league, cup };
}

$("#entry").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#entry-err").textContent = "";
  let body;
  try {
    body = readEntry();
  } catch (err) {
    $("#entry-err").textContent = err.message;
    return;
  }
  const editing = state.editingId != null;
  const msg = `${editing ? "Cập nhật" : "Lưu"} giải ${fmtDate(body.date)}: League ${body.league.length} người, Cup ${body.cup.length} người?`;
  if (!(await confirmBox(msg))) return;
  try {
    await api(editing ? `/api/sessions/${state.editingId}` : "/api/sessions", { method: editing ? "PUT" : "POST", body });
    haptic();
    toast(editing ? "Đã cập nhật" : "Đã lưu");
    state.editingId = null;
    showTab("board");
  } catch (err) {
    haptic("error");
    $("#entry-err").textContent = err.message;
  }
});

// ---------- cơ thủ ----------
async function loadPlayers() {
  state.players = await api("/api/players");
  return state.players;
}

async function renderPlayers() {
  await loadPlayers();
  $("#player-list").innerHTML = state.players
    .map(
      (p) => `<div class="player">
      <div class="av-edit">
        <button type="button" class="av-btn" data-pav="${p.id}" title="Đổi ảnh">${avatarHtml(p.id, p.name, p.avatar_v, "sm")}</button>
        ${p.avatar_v ? `<button type="button" class="av-x" data-pavdel="${p.id}" title="Xoá ảnh">✕</button>` : ""}
      </div>
      <input value="${esc(p.name)}" data-pname="${p.id}" maxlength="40" />
      <textarea rows="1" data-pnote="${p.id}" placeholder="Ghi chú">${esc(p.note ?? "")}</textarea>
      <button class="mini" data-psave="${p.id}">Lưu</button>
      <button class="mini danger" data-pdel="${p.id}">Xoá</button>
    </div>`,
    )
    .join("");
  document.querySelectorAll("#tab-players textarea").forEach(autoGrow);
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}
$("#tab-players").addEventListener("input", (e) => {
  if (e.target.tagName === "TEXTAREA") autoGrow(e.target);
});

// Thu nhỏ ảnh về tối đa 256px trước khi tải lên (giữ nền trong suốt)
function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL("image/webp", 0.9);
      if (!data.startsWith("data:image/webp")) data = c.toDataURL("image/png");
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh này."));
    };
    img.src = url;
  });
}

let avatarTarget = null;
const avatarInput = document.createElement("input");
avatarInput.type = "file";
avatarInput.accept = "image/*";
avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files[0];
  avatarInput.value = "";
  if (!file || avatarTarget == null) return;
  $("#player-err").textContent = "";
  try {
    const data = await resizeImage(file);
    await api(`/api/players/${avatarTarget}/avatar`, { method: "POST", body: { data } });
    haptic();
    toast("Đã cập nhật ảnh");
    renderPlayers();
  } catch (err) {
    $("#player-err").textContent = err.message;
  }
});

$("#player-list").addEventListener("click", async (e) => {
  const save = e.target.closest("[data-psave]");
  const del = e.target.closest("[data-pdel]");
  const av = e.target.closest("[data-pav]");
  const avDel = e.target.closest("[data-pavdel]");
  $("#player-err").textContent = "";
  if (av) {
    avatarTarget = av.dataset.pav;
    avatarInput.click();
    return;
  }
  try {
    if (avDel) {
      if (!(await confirmBox("Xoá ảnh đại diện của cơ thủ này?"))) return;
      await api(`/api/players/${avDel.dataset.pavdel}/avatar`, { method: "DELETE" });
      toast("Đã xoá ảnh");
      renderPlayers();
      return;
    }
    if (save) {
      const id = save.dataset.psave;
      await api(`/api/players/${id}`, {
        method: "PUT",
        body: { name: $(`[data-pname="${id}"]`).value, note: $(`[data-pnote="${id}"]`).value },
      });
      toast("Đã lưu");
    }
    if (del) {
      const id = del.dataset.pdel;
      if (!(await confirmBox("Xoá cơ thủ này?"))) return;
      await api(`/api/players/${id}`, { method: "DELETE" });
      toast("Đã xoá");
      renderPlayers();
    }
  } catch (err) {
    $("#player-err").textContent = err.message;
  }
});

$("#player-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#player-err").textContent = "";
  try {
    await api("/api/players", { method: "POST", body: { name: $("#new-name").value, note: $("#new-note").value } });
    $("#new-name").value = "";
    $("#new-note").value = "";
    autoGrow($("#new-note"));
    toast("Đã thêm");
    renderPlayers();
  } catch (err) {
    $("#player-err").textContent = err.message;
  }
});

// ---------- người đã mở app ----------
const fmtTime = (t) => {
  const d = new Date(String(t).replace(" ", "T") + "Z");
  return isNaN(d) ? t : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
};
async function loadVisitors() {
  const box = $("#visitors");
  try {
    const list = await api("/api/visitors");
    $("#visitor-count").textContent = `(${list.length})`;
    box.innerHTML = `<thead><tr><th class="n">Tên</th><th class="n">Username</th><th>Telegram ID</th><th>Lần mở</th><th>Lần cuối</th></tr></thead>
      <tbody>${list
        .map(
          (v) => `<tr>
          <td class="n"><span class="vis-n">${v.photo_url ? `<img src="${esc(v.photo_url)}" alt="" />` : ""}${esc([v.first_name, v.last_name].filter(Boolean).join(" ") || "?")}</span></td>
          <td class="n">${v.username ? `<a href="https://t.me/${esc(v.username)}" target="_blank">@${esc(v.username)}</a>` : "–"}</td>
          <td>${v.tg_id}</td><td>${v.visits}</td><td>${fmtTime(v.last_seen)}</td>
        </tr>`,
        )
        .join("") || `<tr><td colspan="5" class="hint">Chưa có ai mở app.</td></tr>`}</tbody>`;
  } catch (e) {
    $("#visitor-count").textContent = "";
    box.innerHTML = `<tbody><tr><td class="err">${esc(e.message)}</td></tr></tbody>`;
  }
}

// ---------- khởi động ----------
(async function init() {
  try {
    const me = await api("/api/me");
    state.isAdmin = me.isAdmin;
    document.body.classList.toggle("admin", me.isAdmin);
    const name = me.user ? me.user.first_name || me.user.username : "";
    $("#who").textContent = me.isAdmin ? `${name} · admin` : name ? `${name} · User` : "User";
  } catch {
    $("#who").textContent = "User";
  }
  showTab("board");
})();
