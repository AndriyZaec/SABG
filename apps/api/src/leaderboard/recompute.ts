import type { Uuid } from "@arena/contracts";
import { arenaResultRepository } from "../db/repositories/arena-result.repository.js";
import { leaderboardRepository } from "../db/repositories/leaderboard.repository.js";
import { payoutRepository } from "../db/repositories/payout.repository.js";
import { rankPlayers } from "./player-ranking.js";

/**
 * Rebuilds an open scope's leaderboard from its competitions' arena results. A full rebuild, so a
 * repeated run writes the same rows. The inputs are read under the scope lock (on another connection,
 * which sees everything committed before the lock was granted). False when the scope is missing or
 * closed: a closed scope keeps the result of its final recompute, which runs before it closes.
 */
export async function recomputeScope(scopeId: Uuid, now?: Date): Promise<boolean> {
  return leaderboardRepository.replaceEntries(scopeId, async () => {
    const results = await arenaResultRepository.listByCompetitions(await leaderboardRepository.listCompetitionIds(scopeId));
    const payouts = await payoutRepository.sentTotalsByUser([...new Set(results.map((result) => result.arenaId))]);
    return rankPlayers(results, payouts);
  }, now);
}
