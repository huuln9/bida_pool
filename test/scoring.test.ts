import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeaderboard, computeTable, denseRanks } from "../src/scoring.ts";
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
    pts: r.points, rank: r.rank, dp: r.points_delta, dr: r.rank_delta,
  });
  assert.deepEqual(t.map(pick), [
    { name: "Chang", games: 30, win: 18, lose: 12, rate: 60, lp: 2, lw: 1, lr: [3, 1], lpts: 4, cp: 2, cw: 2, cr: [1, 1], cpts: 6, pts: 28, rank: 1, dp: 11, dr: 0 },
    { name: "Hữu", games: 30, win: 16, lose: 14, rate: 53.3, lp: 2, lw: 0, lr: [2, 2], lpts: 4, cp: 2, cw: 0, cr: [2, 2], cpts: 4, pts: 24, rank: 2, dp: 12, dr: 0 },
    { name: "Loan", games: 30, win: 16, lose: 14, rate: 53.3, lp: 2, lw: 1, lr: [1, 3], lpts: 4, cp: 2, cw: 0, cr: [4, 3], cpts: 1, pts: 21, rank: 3, dp: 12, dr: 0 },
    { name: "An", games: 15, win: 11, lose: 4, rate: 73.3, lp: 1, lw: 1, lr: [1], lpts: 3, cp: 1, cw: 1, cr: [1], cpts: 3, pts: 17, rank: 4, dp: 0, dr: -3 },
    { name: "Đức", games: 30, win: 10, lose: 20, rate: 33.3, lp: 2, lw: 0, lr: [3, 4], lpts: 1, cp: 2, cw: 0, cr: [3, 4], cpts: 1, pts: 12, rank: 5, dp: 8, dr: -1 },
  ]);
  assert.equal(t.find((r) => r.name === "An")!.played_latest, false);
});
