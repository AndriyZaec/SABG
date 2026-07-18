import { eq, inArray } from "drizzle-orm";

import { db, tryAcquireFixtureRuntimeLock } from "./client.js";
import {
  arenaPlayers,
  arenas,
  replayResetAudits,
  entryPasses,
  liveEvents,
  matches,
  payouts,
  predictionRounds,
  predictions,
} from "./schema.js";
import { assertArenaRecyclable } from "../onchain/index.js";

export interface ReplayResetAudit {
  timestamp: string;
  fixtureId: number;
  database: string;
  outcome: "reset" | "nothing_to_reset";
  arenas: Array<{
    id: string;
    status: string;
    onchainArenaId: number | null;
    escrowAccount: string;
  }>;
}

export async function resetReplayFixture(fixtureId: number, database: string): Promise<ReplayResetAudit> {
  const releaseLock = await tryAcquireFixtureRuntimeLock(fixtureId);
  if (!releaseLock) {
    throw new Error(`Refusing to reset fixture ${fixtureId}: its gateway runtime is active`);
  }

  try {
    const [existingMatch] = await db.select().from(matches).where(eq(matches.txoddsFixtureId, fixtureId));
    if (existingMatch) {
      const existingArenas = await db.select().from(arenas).where(eq(arenas.matchId, existingMatch.id));
      for (const arena of existingArenas) {
        if (arena.onchainArenaId != null) await assertArenaRecyclable(arena.onchainArenaId);
      }
    }

    return await db.transaction(async (tx) => {
      const [match] = await tx.select().from(matches).where(eq(matches.txoddsFixtureId, fixtureId)).for("update");
      const timestamp = new Date().toISOString();
      if (!match) {
        const audit = { timestamp, fixtureId, database, outcome: "nothing_to_reset" as const, arenas: [] };
        await tx.insert(replayResetAudits).values({
          recordedAt: new Date(timestamp),
          fixtureId,
          database,
          outcome: audit.outcome,
          arenas: audit.arenas,
        });
        return audit;
      }

      const arenaRows = await tx.select().from(arenas).where(eq(arenas.matchId, match.id));
      const roundRows = await tx.select({ id: predictionRounds.id }).from(predictionRounds).where(eq(predictionRounds.matchId, match.id));
      const arenaIds = arenaRows.map((arena) => arena.id);
      const roundIds = roundRows.map((round) => round.id);

      if (roundIds.length > 0) await tx.delete(predictions).where(inArray(predictions.roundId, roundIds));
      if (arenaIds.length > 0) {
        await tx.delete(payouts).where(inArray(payouts.arenaId, arenaIds));
        await tx.delete(arenaPlayers).where(inArray(arenaPlayers.arenaId, arenaIds));
        await tx.delete(entryPasses).where(inArray(entryPasses.arenaId, arenaIds));
        await tx.delete(predictionRounds).where(inArray(predictionRounds.arenaId, arenaIds));
        await tx.delete(arenas).where(inArray(arenas.id, arenaIds));
      }
      await tx.delete(liveEvents).where(eq(liveEvents.matchId, match.id));
      await tx.delete(matches).where(eq(matches.id, match.id));

      const audit: ReplayResetAudit = {
        timestamp,
        fixtureId,
        database,
        outcome: "reset",
        arenas: arenaRows.map((arena) => ({
          id: arena.id,
          status: arena.status,
          onchainArenaId: arena.onchainArenaId,
          escrowAccount: arena.escrowAccount,
        })),
      };
      await tx.insert(replayResetAudits).values({
        recordedAt: new Date(timestamp),
        fixtureId,
        database,
        outcome: audit.outcome,
        arenas: audit.arenas,
      });
      return audit;
    });
  } finally {
    await releaseLock();
  }
}
