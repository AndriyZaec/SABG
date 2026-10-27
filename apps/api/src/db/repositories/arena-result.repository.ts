import { inArray } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { arenaResults } from "../schema.js";

export interface ArenaResultRow {
  arenaId: Uuid;
  userId: Uuid;
  competitionId: Uuid;
  score: number;
  rank: number;
  won: boolean;
  roundsPlayed: number;
  playersCount: number;
  finishedAt: Date;
}

export const arenaResultRepository = {
  /** Idempotent: an arena's results are written once, so a repeated write keeps the first rows. */
  async insertMany(rows: readonly ArenaResultRow[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(arenaResults).values([...rows]).onConflictDoNothing({ target: [arenaResults.arenaId, arenaResults.userId] });
  },

  async listByCompetitions(competitionIds: readonly Uuid[]): Promise<ArenaResultRow[]> {
    if (competitionIds.length === 0) return [];
    return db
      .select({
        arenaId: arenaResults.arenaId,
        userId: arenaResults.userId,
        competitionId: arenaResults.competitionId,
        score: arenaResults.score,
        rank: arenaResults.rank,
        won: arenaResults.won,
        roundsPlayed: arenaResults.roundsPlayed,
        playersCount: arenaResults.playersCount,
        finishedAt: arenaResults.finishedAt,
      })
      .from(arenaResults)
      .where(inArray(arenaResults.competitionId, [...competitionIds]));
  },
};
