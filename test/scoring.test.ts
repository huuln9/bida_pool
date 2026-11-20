import { test } from "node:test";
import assert from "node:assert/strict";
import { bonusForStreak, computeLeaderboard, computeTable, denseRanks } from "../src/scoring.ts";
import { players, results, sessions } from "./fixtures.ts";

test("dense rank: 9,9,7,6 -> 1,1,2,3", () => {
  const items = [9, 9, 7, 6].map((w) => ({ w }));
  const r = denseRanks(items, (x) => x.w);
  assert.deepEqual(items.map((i) => r.get(i)), [1, 1, 2, 3]);
});

test("bảng sau buổi 1 khớp bảng cũ (17/17/12/9/4)", () => {
  const t = computeTable(players, sessions.slice(0, 1), results);
  assert.deepEqual(t.map((r) => [r.name, r.points, r.rank]), [
    ["An", 17, 1], ["Chang", 17, 1], ["Hữu", 12, 2], ["Loan", 9, 3], ["Đức", 4, 4],
  ]);
});

test("bảng sau buổi 2 khớp bảng đã chốt", () => {
  const t = computeLeaderboard(players, sessions, results);
  const pick = (r: (typeof t)[number]) => ({
    name: r.name, games: r.games, win: r.win, lose: r.lose, rate: r.win_rate,
    lp: r.league_played, lw: r.league_win, lr: r.league_ranks, lpts: r.league_pts,
    cp: r.cup_played, cw: r.cup_win, cr: r.cup_ranks, cpts: r.cup_pts,
    sp: r.streak_pts, pts: r.points, rank: r.rank, dp: r.points_delta, dr: r.rank_delta,
  });
  assert.deepEqual(t.map(pick), [
    { name: "Chang", games: 30, win: 18, lose: 12, rate: 60, lp: 2, lw: 1, lr: [3, 1], lpts: 4, cp: 2, cw: 2, cr: [1, 1], cpts: 6, sp: 2, pts: 30, rank: 1, dp: 13, dr: 0 },
    { name: "Hữu", games: 30, win: 16, lose: 14, rate: 53.3, lp: 2, lw: 0, lr: [2, 2], lpts: 4, cp: 2, cw: 0, cr: [2, 2], cpts: 4, sp: 2, pts: 26, rank: 2, dp: 14, dr: 0 },
    { name: "Loan", games: 30, win: 16, lose: 14, rate: 53.3, lp: 2, lw: 1, lr: [1, 3], lpts: 4, cp: 2, cw: 0, cr: [4, 3], cpts: 1, sp: 2, pts: 23, rank: 3, dp: 14, dr: 0 },
    { name: "An", games: 15, win: 11, lose: 4, rate: 73.3, lp: 1, lw: 1, lr: [1], lpts: 3, cp: 1, cw: 1, cr: [1], cpts: 3, sp: 0, pts: 17, rank: 4, dp: 0, dr: -3 },
    { name: "Đức", games: 30, win: 10, lose: 20, rate: 33.3, lp: 2, lw: 0, lr: [3, 4], lpts: 1, cp: 2, cw: 0, cr: [3, 4], cpts: 1, sp: 2, pts: 14, rank: 5, dp: 10, dr: -1 },
  ]);
  assert.equal(t.find((r) => r.name === "An")!.played_latest, false);
  // Vô địch cả League + Cup trong cùng 1 giải
  assert.deepEqual(t.map((r) => [r.name, r.double_win]), [
    ["Chang", 1], ["Hữu", 0], ["Loan", 0], ["An", 1], ["Đức", 0],
  ]);
});

test("điểm thưởng chuỗi: 1→0, 2→2, 3→3, 4→4, từ 5→5 và cộng dồn", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(bonusForStreak), [0, 2, 3, 4, 5, 5, 5]);
  // 7 giải liên tiếp: 0+2+3+4+5+5+5 = 24
  const ss = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, date: `2026-01-0${i + 1}` }));
  const rs = ss.map((s) => ({ session_id: s.id, player_id: 1, type: "CUP" as const, win: 0, lose: 0, rank: 4 }));
  const [row] = computeTable([{ id: 1, name: "X", note: null }], ss, rs);
  assert.equal(row.streak_pts, 24);
  assert.equal(row.streak, 7);
});
