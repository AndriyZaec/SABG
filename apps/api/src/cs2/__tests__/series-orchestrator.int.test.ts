// DB integration test for the CS2 persistence "glue" (series-orchestrator.ts). Same pattern as
// db/__tests__/repositories.int.test.ts: gated on DATABASE_URL, dynamic imports (db/client.ts
// throws synchronously at import time when DATABASE_URL is unset), unique-per-run identifiers,
// FK-ordered cleanup. Drives the orchestrator with a synthetic Cs2SeriesSnapshot sequence — no
// live GRID connection — so this is honestly exercised end-to-end against Postgres without one.

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

const MIN = 60_000;
/** Each test picks its own anchor (offset from `Date.now()`) so their Arena-creation timestamps
 *  never collide on `matches`' (homeTeam, awayTeam, startTime) unique index — real Series only
 *  collide there if two *different* series share both team names and the exact same millisecond
 *  Arena-open timestamp, negligible for a live poller but trivially real for two `it` blocks that
 *  reuse a literal constant (caught by this test the first time it was written). */
function clockFrom(anchorIso: string): (offsetMinutes: number) => string {
  return (offsetMinutes: number) => new Date(Date.parse(anchorIso) + offsetMinutes * MIN).toISOString();
}

function snapshot(opts: { teams?: [number, number]; hasLiveGame?: boolean; finished?: boolean }): Cs2SeriesSnapshot {
  const [a, b] = opts.teams ?? [0, 0];
  return {
    format: 3,
    finished: opts.finished ?? false,
    hasLiveGame: opts.hasLiveGame ?? false,
    teams: [
      { name: "Team A", score: a, won: false },
      { name: "Team B", score: b, won: false },
    ],
  };
}

describe.skipIf(!RUN)("Cs2SeriesOrchestrator (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let seriesRepository: typeof import("../../db/repositories/series.repository.js")["seriesRepository"];
  let arenaRepository: typeof import("../../db/repositories/arena.repository.js")["arenaRepository"];
  let matchRepository: typeof import("../../db/repositories/match.repository.js")["matchRepository"];
  let entryPassRepository: typeof import("../../db/repositories/entry-pass.repository.js")["entryPassRepository"];
  let predictionRoundRepository: typeof import("../../db/repositories/prediction-round.repository.js")["predictionRoundRepository"];
  let WriteQueue: typeof import("../../gateway/stores/write-queue.js")["WriteQueue"];
  let Cs2SeriesOrchestrator: typeof import("../series-orchestrator.js")["Cs2SeriesOrchestrator"];
  let userRepository: typeof import("../../db/repositories/user.repository.js")["userRepository"];

  const arenaIds: string[] = [];
  const matchIds: string[] = [];
  const seriesIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ seriesRepository } = await import("../../db/repositories/series.repository.js"));
    ({ arenaRepository } = await import("../../db/repositories/arena.repository.js"));
    ({ matchRepository } = await import("../../db/repositories/match.repository.js"));
    ({ entryPassRepository } = await import("../../db/repositories/entry-pass.repository.js"));
    ({ predictionRoundRepository } = await import("../../db/repositories/prediction-round.repository.js"));
    ({ WriteQueue } = await import("../../gateway/stores/write-queue.js"));
    ({ Cs2SeriesOrchestrator } = await import("../series-orchestrator.js"));
    ({ userRepository } = await import("../../db/repositories/user.repository.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    for (const arenaId of arenaIds) {
      await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.arenaId, arenaId));
      await db.delete(schema.entryPasses).where(eq(schema.entryPasses.arenaId, arenaId));
      await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    }
    for (const matchId of matchIds) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    for (const seriesId of seriesIds) await db.delete(schema.series).where(eq(schema.series.id, seriesId));
    for (const userId of userIds) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("opens Arena #1 in lobby, persists Round 1, flips to live on Match Live Detected, then cancels the reactively-opened Arena #2 on a forfeit — Series ends up decided, not invalid", async () => {
    const at = clockFrom(new Date(Date.now()).toISOString());
    const gridSeriesId = `int-test-${randomUUID()}`;
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, { format: 3, scheduledStartTime: new Date(at(0)) });
    seriesIds.push(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = new Cs2SeriesOrchestrator(series, { writeQueue, entryFeeLamports: 1000 });

    // Arena #1 opens at scheduledStartTime - 10min.
    await orchestrator.poll(snapshot({}), at(-10));
    const matchesForSeries = (await matchRepository.list()).filter((m) => m.seriesId === series.id);
    expect(matchesForSeries).toHaveLength(1);
    const match1Id = matchesForSeries[0]!.id;
    matchIds.push(match1Id);
    const foundArena1 = await arenaRepository.findByMatchId(match1Id);
    expect(foundArena1).toBeDefined();
    const arena1Id = foundArena1!.id;
    arenaIds.push(arena1Id);
    expect(foundArena1?.status).toBe("lobby");

    await writeQueue.drain();
    const roundsForArena1 = await predictionRoundRepository.listByArenaId(arena1Id);
    expect(roundsForArena1).toHaveLength(1);
    expect(roundsForArena1[0]).toMatchObject({ roundNumber: 1, status: "open" });

    // Match 1 goes live -> Arena #1 flips to live.
    await orchestrator.poll(snapshot({ hasLiveGame: true }), at(0));
    const arena1AfterMld = await arenaRepository.findById(arena1Id);
    expect(arena1AfterMld?.status).toBe("live");

    // Match 1 ends 1-0 -> Arena #2 opens reactively, sits in lobby.
    await orchestrator.poll(snapshot({ hasLiveGame: false, teams: [1, 0] }), at(20));
    const matchesAfterM1 = (await matchRepository.list()).filter((m) => m.seriesId === series.id);
    expect(matchesAfterM1).toHaveLength(2);
    const match2Id = matchesAfterM1.find((m) => m.id !== match1Id)!.id;
    matchIds.push(match2Id);
    const arena2 = await arenaRepository.findByMatchId(match2Id);
    expect(arena2?.status).toBe("lobby");
    arenaIds.push(arena2!.id);

    // Someone bought into Arena #2 before the forfeit — should get refunded.
    const walletAddress = `int-test-wallet-${randomUUID()}`;
    const user = await userRepository.upsertByWallet(walletAddress, "int-test-user");
    userIds.push(user.id);
    const entryPass = await entryPassRepository.create({
      arenaId: arena2!.id,
      userId: user.id,
      walletAddress,
      amountLamports: 1000,
      txSignature: `sig-${randomUUID()}`,
    });

    // Match 2 never goes live — the series envelope jumps straight to 2-0/finished (forfeit,
    // data-assumptions.md #12), well within the 60min no-show window.
    await orchestrator.poll(snapshot({ hasLiveGame: false, teams: [2, 0], finished: true }), at(22));

    const cancelledArena2 = await arenaRepository.findById(arena2!.id);
    expect(cancelledArena2).toMatchObject({ status: "cancelled", cancelledReason: "series_decided" });

    const refundedPass = await entryPassRepository.listByArenaId(arena2!.id);
    expect(refundedPass.find((p) => p.id === entryPass.id)?.status).toBe("refunded");

    const decidedSeries = await seriesRepository.findById(series.id);
    expect(decidedSeries?.status).toBe("decided"); // forfeit ≠ no-show — never "invalid"
  });

  it("cancels Arena #1 with reason no_show and marks the Series invalid when Match Live Detected never arrives within 60min", async () => {
    // A different anchor from the test above (+3h) so this test's Arena #1 never collides on
    // (homeTeam, awayTeam, startTime) with the other test's, even though both use "Team A"/"Team B".
    const at = clockFrom(new Date(Date.now() + 3 * 60 * MIN).toISOString());
    const gridSeriesId = `int-test-${randomUUID()}`;
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, { format: 3, scheduledStartTime: new Date(at(0)) });
    seriesIds.push(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = new Cs2SeriesOrchestrator(series, { writeQueue, entryFeeLamports: 1000 });

    await orchestrator.poll(snapshot({}), at(-10)); // Arena #1 opens
    const match1 = (await matchRepository.list()).find((m) => m.seriesId === series.id)!;
    matchIds.push(match1.id);
    const arena1 = await arenaRepository.findByMatchId(match1.id);
    arenaIds.push(arena1!.id);

    await orchestrator.poll(snapshot({ hasLiveGame: false }), at(61)); // 61min, still no MLD

    const cancelled = await arenaRepository.findById(arena1!.id);
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledReason: "no_show" });

    const invalidSeries = await seriesRepository.findById(series.id);
    expect(invalidSeries?.status).toBe("invalid");
  });
});
