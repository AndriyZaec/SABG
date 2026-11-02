import type { Uuid } from "@arena/contracts";
import { arenaResultRepository } from "../db/repositories/arena-result.repository.js";
import { leaderboardRepository } from "../db/repositories/leaderboard.repository.js";
import { payoutRepository } from "../db/repositories/payout.repository.js";
import { rankPlayers } from "./player-ranking.js";

/**
 * Rebuilds an open scope's leaderboard from its competitions' arena results. A full rebuild, so a
 * repeated run writes the same rows. False when the scope is missing or closed, also when it closes
 * mid-run: a closed scope keeps the result of its final recompute, which runs before it closes.
 */
export async function recomputeScope(scopeId: Uuid, now: Date = new Date()): Promise<boolean> {
  const scope = await leaderboardRepository.findScope(scopeId);
  if (scope?.status !== "open") return false;

  const results = await arenaResultRepository.listByCompetitions(await leaderboardRepository.listCompetitionIds(scopeId));
  const payouts = await payoutRepository.sentTotalsByUser([...new Set(results.map((result) => result.arenaId))]);
  return leaderboardRepository.replaceEntries(scopeId, rankPlayers(results, payouts), now);
}
