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
          <th colspan="2" class="g pt">Tổng</th>
        </tr>
        <tr>
        <th>Total<br>Rank</th><th class="n">Player</th><th>Game<br>Play</th><th>Win</th><th>Lose</th><th>Win<br>%</th>
        <th class="g lg">L.<br>Play</th><th class="lg">L.<br>Win</th><th class="lg">L.<br>Rank</th><th class="lg">L.<br>Pts</th>
        <th class="g cp">C.<br>Play</th><th class="cp">C.<br>Win</th><th class="cp">C.<br>Rank</th><th class="cp">C.<br>Pts</th><th class="g pt">Pts</th><th class="pt"></th>
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
      sec("Ký hiệu", [
        "L. = League · C. = Cup · Pts = Points",
        `Rank: hạng ${RANK_HISTORY} giải gần nhất, mới nhất → cũ nhất`,
        `Màu hạng: <span class="r r1">1</span> vàng · <span class="r r2">2</span> bạc · <span class="r r3">3</span> đồng`,
        `<span class="c-up">▲</span><span class="c-down">▼</span> cạnh tên: lên / xuống hạng so với giải trước`,
        `<span class="c-up">▲</span> cạnh Pts: số điểm tăng so với giải trước`,
      ]),
      sec("Cách tính điểm", [
        "Thắng 1 trận: +1",
        "Hạng League / Cup: Top 1 +3 · Top 2 +2 · Top 3 +1 · Top 4 +0",
        "<b>Pts = Win + L. Pts + C. Pts</b>",
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
// Huy hiệu cánh cho danh hiệu Top N (màu lấy theo biến --c1/--c2/--c3 của thẻ)
const CREST_WING = "M82 50 C60 46 30 34 4 4 C14 28 22 37 30 42 C18 42 10 39 4 35 C17 50 32 56 46 58 C36 60 27 60 18 58 C34 70 58 71 84 63 Z";
const CREST_WING_HL = "M76 52 C56 48 34 38 16 20";
function crestSvg(rank, tier, uid) {
  const g = `cw${uid}`, p = `cp${uid}`;
  const plate = `<stop offset="0" style="stop-color:var(--c1)"/><stop offset=".45" style="stop-color:var(--c3)"/><stop offset="1" style="stop-color:var(--c2)"/>`;
  const top = tier === 1
    ? `<path class="w" fill="url(#${g})" d="M78 34 L84 14 L92 28 L100 2 L108 28 L116 14 L122 34 Z"/>`
    : `<path class="w" fill="url(#${g})" d="M88 32 L100 10 L112 32 Z"/>`;
  const mirror = `transform="translate(200 0) scale(-1 1)"`;
  return `<svg class="crest" viewBox="0 0 200 84" aria-label="Top ${rank}">
    <defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--c1)"/><stop offset=".55" style="stop-color:var(--c3)"/><stop offset="1" style="stop-color:var(--c2)"/>
      </linearGradient>
      <linearGradient id="${p}" x1="0" y1="0" x2="0" y2="1">${plate}</linearGradient>
    </defs>
    <path class="w" fill="url(#${g})" d="${CREST_WING}"/>
    <path class="w" fill="url(#${g})" d="${CREST_WING}" ${mirror}/>
    <path class="hl" d="${CREST_WING_HL}"/><path class="hl" d="${CREST_WING_HL}" ${mirror}/>
    ${top}
    <path class="pl" fill="url(#${p})" d="M60 34 L100 26 L140 34 L136 60 L100 78 L64 60 Z"/>
    <path class="hl" d="M66 38 L100 31 L134 38"/>
    <text x="100" y="54" text-anchor="middle" dominant-baseline="middle">TOP ${rank}</text>
  </svg>`;
}
// Mỗi lần vô địch League hoặc Cup = 1 sao vàng
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
        const tier = r.stars ? Math.min(ranks[i], 4) : 4;
        const stars = r.stars ? "★".repeat(r.stars) : "☆";
        const detail =
          (r.league_win ? `<span class="tag tag-l">League ×${r.league_win}</span>` : "") +
          (r.cup_win ? `<span class="tag tag-c">Cup ×${r.cup_win}</span>` : "");
        return `<div class="ach ach-t${tier} ${r.stars ? "" : "ach-0"}">
          <div class="ach-title">${crestSvg(ranks[i], tier, i)}</div>
          <div class="ach-card">
            <div class="ach-rib">${esc(r.name)}</div>
            <div class="ach-img">${avatarHtml(r.player_id, r.name, avatars[r.player_id], "ach-av")}</div>
            <div class="ach-box">
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
    $("#who").textContent = me.isAdmin ? `${name} · admin` : name ? `${name} · chỉ xem` : "Chỉ xem";
  } catch {
    $("#who").textContent = "Chỉ xem";
  }
  showTab("board");
})();
