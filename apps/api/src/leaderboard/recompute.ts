import type { Uuid } from "@arena/contracts";
import { arenaResultRepository } from "../db/repositories/arena-result.repository.js";
import { leaderboardRepository, type EndScopeResult } from "../db/repositories/leaderboard.repository.js";
import { payoutRepository } from "../db/repositories/payout.repository.js";
import { rankPlayers, type PlayerRanking } from "./player-ranking.js";

/**
 * Rebuilds an open scope's leaderboard from its competitions' arena results. A full rebuild, so a
 * repeated run writes the same rows. The inputs are read under the scope lock (on another connection,
 * which sees everything committed before the lock was granted). False when the scope is missing or
 * closed: a closed scope keeps the result of its final recompute, which runs before it closes.
 */
export async function recomputeScope(scopeId: Uuid, now?: Date): Promise<boolean> {
  return leaderboardRepository.replaceEntries(scopeId, () => computeEntries(scopeId), now);
}

/** Ends the current scope with its final ranking computed under the same lock (see `endCurrent`). */
export async function endScope(scopeId: Uuid, now?: Date): Promise<EndScopeResult> {
  return leaderboardRepository.endCurrent(scopeId, () => computeEntries(scopeId), now);
}

// Runs inside the caller's scope lock, so it reads everything committed before the lock was granted.
async function computeEntries(scopeId: Uuid): Promise<PlayerRanking[]> {
  const results = await arenaResultRepository.listByCompetitions(await leaderboardRepository.listCompetitionIds(scopeId));
  const payouts = await payoutRepository.sentTotalsByUser([...new Set(results.map((result) => result.arenaId))]);
  // Marks are applied under the same lock, so a run sees every applied mark or none.
  const marks = await leaderboardRepository.listMarks(scopeId);
  const disqualified = new Set(marks.filter((mark) => mark.status === "disqualified").map((mark) => mark.userId));
  return rankPlayers(results, payouts, disqualified);
}
