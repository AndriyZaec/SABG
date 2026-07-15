// Leaderboard Service core: pure ranking/winner-resolution logic (spec §7). No I/O, no engine
// state — `service.ts` owns the accumulator map and decides *when* to call these.
//
// Scope note (product decision): spec §7's score -> speed -> missed -> joinedAt chain governs
// `rankLeaderboard`'s *display* ordering below, but deliberately does NOT decide winners. Winners
// are simply "everyone still standing when the arena ends" (one survivor, all full-time
// survivors, or — if a round eliminates the last active players simultaneously — all pre-round
// finalists); equal split among them is the payout service's concern, not this module's.

import type { ArenaPlayerStatus, IsoDateTime, LeaderboardEntry, Uuid } from "@arena/contracts";

/** Internal per-player accumulator row `service.ts` maintains across rounds. */
export interface LeaderboardAccumulator {
  userId: Uuid;
  username: string;
  status: ArenaPlayerStatus;
  score: number;
  /** Avg (answeredAt - openedAt) ms — spec §7 tie-breaker 1. Unset until settlement plumbs timing through. */
  avgAnswerMs?: number;
  missedCount: number;
  joinedAt: IsoDateTime;
}

/** Ascending compare with `undefined` treated as "no data" — that rung is skipped, not last/first. */
function compareOptional(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a - b;
}

/**
 * Spec §7's tie-break chain, applied to *display* ordering only (never to who wins — see the
 * scope note above): score descending, then avg answer speed ascending (when both rows have it),
 * then fewer missed rounds, then earlier joinedAt. Returns 0 only on a genuine full tie.
 */
function compareTieBreak(a: LeaderboardAccumulator, b: LeaderboardAccumulator): number {
  if (b.score !== a.score) return b.score - a.score;
  const speedDiff = compareOptional(a.avgAnswerMs, b.avgAnswerMs);
  if (speedDiff !== 0) return speedDiff;
  if (a.missedCount !== b.missedCount) return a.missedCount - b.missedCount;
  return a.joinedAt.localeCompare(b.joinedAt);
}

/**
 * Produces a display-ordered, ranked snapshot: active/winner rows before eliminated ones, then
 * the spec §7 tie-break chain (score -> speed -> missed -> joinedAt). This ordering is
 * display-only and never changes who wins (see the scope note above). A rank is shared only on a
 * genuine full tie across the whole chain (1-based).
 */
export function rankLeaderboard(rows: LeaderboardAccumulator[]): LeaderboardEntry[] {
  const statusBand = (status: ArenaPlayerStatus): number => (status === "eliminated" ? 1 : 0);

  const sorted = [...rows].sort((a, b) => {
    const bandDiff = statusBand(a.status) - statusBand(b.status);
    if (bandDiff !== 0) return bandDiff;
    return compareTieBreak(a, b);
  });

  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  for (const [index, row] of sorted.entries()) {
    const prev = sorted[index - 1];
    const tied = prev !== undefined && statusBand(prev.status) === statusBand(row.status) && compareTieBreak(prev, row) === 0;
    if (!tied) rank = index + 1;
    entries.push({
      userId: row.userId,
      username: row.username,
      status: row.status,
      score: row.score,
      avgAnswerMs: row.avgAnswerMs,
      missedCount: row.missedCount,
      joinedAt: row.joinedAt,
      rank,
    });
  }
  return entries;
}

/**
 * The confirmed winner rule: every finalist wins (equal split, decided elsewhere). Kept as a
 * named function so callers/tests state intent rather than inlining `.map(userId)`.
 */
export function resolveWinners(finalists: LeaderboardAccumulator[]): Uuid[] {
  return finalists.map((row) => row.userId);
}
