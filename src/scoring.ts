// Logic tính điểm thuần (không phụ thuộc DB) để dễ test.

export type ResultType = "LEAGUE" | "CUP";

export interface Player {
  id: number;
  name: string;
  note: string | null;
}

export interface Session {
  id: number;
  date: string; // YYYY-MM-DD
}

export interface Result {
  session_id: number;
  player_id: number;
  type: ResultType;
  win: number;
  lose: number;
  rank: number | null; // CUP: nhập tay; LEAGUE: tự tính từ số trận thắng
}

/** Điểm thưởng theo hạng: Top 1 +3, Top 2 +2, Top 3 +1, còn lại +0. */
export const RANK_BONUS = [3, 2, 1];
export function bonusForRank(rank: number | null): number {
  if (!rank || rank < 1) return 0;
  return RANK_BONUS[rank - 1] ?? 0;
}

/** Điểm thưởng chuỗi mỗi giải theo chuỗi tại giải đó: 1 → 0, 2 → +2, 3 → +3, 4 → +4, từ 5 → +5. */
export const STREAK_MAX = 5;
export function bonusForStreak(streak: number): number {
  return streak < 2 ? 0 : Math.min(streak, STREAK_MAX);
}
export const STREAK_RECENT = 10;

/** Thắng/thua mặc định của Cup theo hạng (Top 1 thắng 2, Top 2-3 thắng 1 thua 1, Top 4 thua 2). */
export function cupDefaultsForRank(rank: number): { win: number; lose: number } {
  if (rank === 1) return { win: 2, lose: 0 };
  if (rank === 2 || rank === 3) return { win: 1, lose: 1 };
  return { win: 0, lose: 2 };
}

/**
 * Xếp hạng đồng hạng kiểu "dense": 9,9,7,6 -> 1,1,2,3.
 * Người bằng điểm cùng hạng và cùng nhận điểm thưởng của hạng đó.
 */
export function denseRanks<T>(items: T[], score: (t: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const out = new Map<T, number>();
  let rank = 0;
  let prev: number | undefined;
  for (const it of sorted) {
    const s = score(it);
    if (s !== prev) {
      rank++;
      prev = s;
    }
    out.set(it, rank);
  }
  return out;
}

/** Gán hạng League cho từng giải dựa trên số trận thắng League trong giải đó. */
export function withLeagueRanks(results: Result[]): Result[] {
  const bySession = new Map<number, Result[]>();
  for (const r of results) {
    if (r.type !== "LEAGUE") continue;
    const list = bySession.get(r.session_id) ?? [];
    list.push(r);
    bySession.set(r.session_id, list);
  }
  const ranked = new Map<Result, number>();
  for (const list of bySession.values()) {
    for (const [r, rank] of denseRanks(list, (x) => x.win)) ranked.set(r, rank);
  }
  return results.map((r) => (r.type === "LEAGUE" ? { ...r, rank: ranked.get(r) ?? null } : r));
}

export interface Row {
  player_id: number;
  name: string;
  note: string | null;
  games: number;
  win: number;
  lose: number;
  win_rate: number; // 0..100
  league_played: number;
  league_win: number; // số lần vô địch League
  league_ranks: number[]; // mới nhất trước
  league_pts: number;
  cup_played: number;
  cup_win: number;
  cup_ranks: number[];
  cup_pts: number;
  /** Số giải vô địch cả League lẫn Cup (mỗi lần được thưởng thêm 1 sao). */
  double_win: number;
  /** Chuỗi tham gia liên tiếp tính tới giải gần nhất, kỷ lục, 10 giải gần nhất (cũ → mới). */
  streak: number;
  best_streak: number;
  recent: boolean[];
  /** Tổng điểm thưởng chuỗi (cộng dồn mỗi giải). */
  streak_pts: number;
  points: number;
  rank: number;
  /** So với bảng trước giải gần nhất. null = không có dữ liệu để so. */
  points_delta: number | null;
  rank_delta: number | null; // dương = lên hạng
  played_latest: boolean;
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
}

/** Tính bảng tổng từ các giải cho trước (chưa có delta). */
export function computeTable(players: Player[], sessions: Session[], rawResults: Result[]): Row[] {
  const ordered = sortSessions(sessions);
  const order = new Map(ordered.map((s, i) => [s.id, i]));
  const results = withLeagueRanks(rawResults.filter((r) => order.has(r.session_id)))
    // mới nhất trước để mảng hạng hiển thị "lần gần nhất → lần trước"
    .sort((a, b) => order.get(b.session_id)! - order.get(a.session_id)!);

  const attended = new Map<number, Set<number>>(); // player_id -> session_id
  for (const r of results) {
    if (!attended.has(r.player_id)) attended.set(r.player_id, new Set());
    attended.get(r.player_id)!.add(r.session_id);
  }

  const rows: Row[] = [];
  for (const p of players) {
    const mine = results.filter((r) => r.player_id === p.id);
    if (mine.length === 0) continue;
    const seq = ordered.map((s) => attended.get(p.id)!.has(s.id));
    let streak = 0, best_streak = 0, streak_pts = 0;
    for (const on of seq) {
      streak = on ? streak + 1 : 0;
      best_streak = Math.max(best_streak, streak);
      if (on) streak_pts += bonusForStreak(streak);
    }
    const league = mine.filter((r) => r.type === "LEAGUE");
    const cup = mine.filter((r) => r.type === "CUP");
    const win = mine.reduce((s, r) => s + r.win, 0);
    const lose = mine.reduce((s, r) => s + r.lose, 0);
    const league_ranks = league.map((r) => r.rank ?? 0);
    const cup_ranks = cup.map((r) => r.rank ?? 0);
    const league_pts = league_ranks.reduce((s, k) => s + bonusForRank(k), 0);
    const cup_pts = cup_ranks.reduce((s, k) => s + bonusForRank(k), 0);
    const leagueChamp = new Set(league.filter((r) => r.rank === 1).map((r) => r.session_id));
    const double_win = cup.filter((r) => r.rank === 1 && leagueChamp.has(r.session_id)).length;
    rows.push({
      player_id: p.id,
      name: p.name,
      note: p.note,
      games: win + lose,
      win,
      lose,
      win_rate: win + lose > 0 ? Math.round((win / (win + lose)) * 1000) / 10 : 0,
      league_played: league.length,
      league_win: league_ranks.filter((k) => k === 1).length,
      league_ranks,
      league_pts,
      cup_played: cup.length,
      cup_win: cup_ranks.filter((k) => k === 1).length,
      cup_ranks,
      cup_pts,
      double_win,
      streak,
      best_streak,
      recent: seq.slice(-STREAK_RECENT),
      streak_pts,
      points: win + league_pts + cup_pts + streak_pts,
      rank: 0,
      points_delta: null,
      rank_delta: null,
      played_latest: false,
    });
  }

  const ranks = denseRanks(rows, (r) => r.points);
  for (const r of rows) r.rank = ranks.get(r)!;
  rows.sort((a, b) => a.rank - b.rank || b.win - a.win || a.name.localeCompare(b.name, "vi"));
  return rows;
}

/** Bảng xếp hạng hiện tại kèm thay đổi điểm/hạng so với trước giải gần nhất. */
export function computeLeaderboard(players: Player[], sessions: Session[], results: Result[]): Row[] {
  const ordered = sortSessions(sessions);
  const now = computeTable(players, ordered, results);
  if (ordered.length < 2) return now;

  const latest = ordered[ordered.length - 1];
  const before = computeTable(players, ordered.slice(0, -1), results);
  const prev = new Map(before.map((r) => [r.player_id, r]));
  const playedLatest = new Set(results.filter((r) => r.session_id === latest.id).map((r) => r.player_id));

  for (const r of now) {
    r.played_latest = playedLatest.has(r.player_id);
    const p = prev.get(r.player_id);
    if (!p) continue; // người mới
    r.points_delta = r.points - p.points;
    r.rank_delta = p.rank - r.rank;
  }
  return now;
}
