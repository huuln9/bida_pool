import type { Player, Result, Session } from "../src/scoring.ts";

// Dữ liệu thật của 2 buổi đầu tiên (giống seed.sql).
export const players: Player[] = [
  { id: 1, name: "An", note: null },
  { id: 2, name: "Chang", note: "Bi 8" },
  { id: 3, name: "Hữu", note: null },
  { id: 4, name: "Loan", note: null },
  { id: 5, name: "Đức", note: null },
];

export const sessions: Session[] = [
  { id: 1, date: "2026-11-11" },
  { id: 2, date: "2026-11-13" },
];

const L = (session_id: number, player_id: number, win: number, lose: number): Result => ({
  session_id, player_id, type: "LEAGUE", win, lose, rank: null,
});
const C = (session_id: number, player_id: number, rank: number, win: number, lose: number): Result => ({
  session_id, player_id, type: "CUP", win, lose, rank,
});

export const results: Result[] = [
  // Buổi 1
  L(1, 1, 9, 4), L(1, 2, 9, 4), L(1, 3, 7, 6), L(1, 4, 6, 7), L(1, 5, 4, 9),
  C(1, 1, 1, 2, 0), C(1, 2, 1, 2, 0), C(1, 3, 2, 1, 1), C(1, 4, 3, 1, 1), C(1, 5, 4, 0, 2),
  // Buổi 2 (An nghỉ)
  L(2, 4, 9, 4), L(2, 3, 7, 6), L(2, 5, 5, 8), L(2, 2, 5, 8),
  C(2, 2, 1, 2, 0), C(2, 3, 2, 1, 1), C(2, 5, 3, 1, 1), C(2, 4, 4, 0, 2),
];
