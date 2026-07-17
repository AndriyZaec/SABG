// Resets the gateway:dev demo flow back to a clean lobby. Deletes the demo match/arena (keyed by
// DEMO_FIXTURE_ID in gateway/run.ts) and everything hanging off it, so the next `gateway:dev`
// boot's `upsertByTxoddsFixtureId` / `upsertForMatch` recreate both rows fresh with
// status: "lobby". Scoped to the demo fixture only — leaves db:seed's matches.json fixtures
// (a different fixture id) untouched.

import dotenv from "dotenv";
import { eq } from "drizzle-orm";

dotenv.config();

/** Same fixture id gateway/run.ts bootstraps (DEMO_FIXTURE_ID). */
const DEMO_FIXTURE_ID = 18179764;

async function main(): Promise<void> {
  const { db } = await import("../client.js");
  const {
    matches,
    arenas,
    predictionRounds,
    arenaPlayers,
    entryPasses,
    predictions,
    payouts,
    liveEvents,
  } = await import("../schema.js");

  const [match] = await db.select().from(matches).where(eq(matches.txoddsFixtureId, DEMO_FIXTURE_ID));
  if (!match) {
    console.log(`no demo match for fixture ${DEMO_FIXTURE_ID} — nothing to reset`);
    return;
  }

  const arenaRows = await db.select().from(arenas).where(eq(arenas.matchId, match.id));

  for (const arena of arenaRows) {
    const roundRows = await db.select().from(predictionRounds).where(eq(predictionRounds.arenaId, arena.id));
    for (const round of roundRows) {
      await db.delete(predictions).where(eq(predictions.roundId, round.id));
    }
    await db.delete(predictionRounds).where(eq(predictionRounds.arenaId, arena.id));
    await db.delete(payouts).where(eq(payouts.arenaId, arena.id));
    await db.delete(arenaPlayers).where(eq(arenaPlayers.arenaId, arena.id));
    await db.delete(entryPasses).where(eq(entryPasses.arenaId, arena.id));
  }

  await db.delete(arenas).where(eq(arenas.matchId, match.id));
  await db.delete(liveEvents).where(eq(liveEvents.matchId, match.id));
  await db.delete(matches).where(eq(matches.id, match.id));

  console.log(`reset demo fixture ${DEMO_FIXTURE_ID} — arena/match wiped, gateway:dev will recreate in lobby`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
