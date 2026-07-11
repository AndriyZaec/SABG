// Leaderboard Service core: pure ranking/winner-resolution logic (spec §7). No I/O, no engine
// state — `service.ts` owns the accumulator map and decides *when* to call these.
//
// Scope note (product decision): spec §7's speed -> missed -> joinedAt tie-break chain is
// deliberately NOT implemented. Winners are simply "everyone still standing when the arena ends"
// (one survivor, all full-time survivors, or — if a round eliminates the last active players
// simultaneously — all pre-round finalists); equal split among them is the payout service's
// concern, not this module's.

import type { ArenaPlayerStatus, IsoDateTime, LeaderboardEntry, Uuid } from "@arena/contracts";

/** Internal per-player accumulator row `service.ts` maintains across rounds. */
export interface LeaderboardAccumulator {
  userId: Uuid;
  username: string;
  status: ArenaPlayerStatus;
  score: number;
  missedCount: number;
  joinedAt: IsoDateTime;
}

/**
 * Produces a display-ordered, ranked snapshot: active/winner rows before eliminated ones, then
 * score descending, ties broken by earlier `joinedAt` for stable ordering only (not a spec §7
 * tie-break — it never changes who wins). Equal score within the same status band shares a rank
 * (1-based), matching the "full tie -> shared" case.
 */
export function rankLeaderboard(rows: LeaderboardAccumulator[]): LeaderboardEntry[] {
  const statusBand = (status: ArenaPlayerStatus): number => (status === "eliminated" ? 1 : 0);

  const sorted = [...rows].sort((a, b) => {
    const bandDiff = statusBand(a.status) - statusBand(b.status);
    if (bandDiff !== 0) return bandDiff;
    if (b.score !== a.score) return b.score - a.score;
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  let lastBand: number | undefined;
  let lastScore: number | undefined;
  for (const row of sorted) {
    const band = statusBand(row.status);
    if (band !== lastBand || row.score !== lastScore) {
      rank = entries.length + 1;
      lastBand = band;
      lastScore = row.score;
    }
    entries.push({
      userId: row.userId,
      username: row.username,
      status: row.status,
      score: row.score,
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
