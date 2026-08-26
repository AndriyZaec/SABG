import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cs2ArenaRuntime } from "../arena-runtime.js";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

const MIN = 60_000;
function clockFrom(anchorIso: string): (offsetMinutes: number) => string {
  return (offsetMinutes: number) => new Date(Date.parse(anchorIso) + offsetMinutes * MIN).toISOString();
}

function snapshot(
  teamIds: readonly [string, string],
  opts: { teams?: [number, number]; hasLiveGame?: boolean; finished?: boolean },
): Cs2SeriesSnapshot {
  const [a, b] = opts.teams ?? [0, 0];
  return {
    format: 3,
    finished: opts.finished ?? false,
    hasLiveGame: opts.hasLiveGame ?? false,
    teams: [
      { teamId: teamIds[0], name: "Team A", score: a, won: false },
      { teamId: teamIds[1], name: "Team B", score: b, won: false },
    ],
  };
}

describe.skipIf(!RUN)("Cs2SeriesOrchestrator (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let seriesRepository: typeof import("../../db/repositories/series.repository.js")["seriesRepository"];
  let arenaRepository: typeof import("../../db/repositories/arena.repository.js")["arenaRepository"];
  let matchRepository: typeof import("../../db/repositories/match.repository.js")["matchRepository"];
  let cs2IdentityRepository: typeof import("../../db/repositories/cs2-identity.repository.js")["cs2IdentityRepository"];
  let entryPassRepository: typeof import("../../db/repositories/entry-pass.repository.js")["entryPassRepository"];
  let predictionRoundRepository: typeof import("../../db/repositories/prediction-round.repository.js")["predictionRoundRepository"];
  let WriteQueue: typeof import("../../gateway/stores/write-queue.js")["WriteQueue"];
  let Cs2SeriesOrchestrator: typeof import("../series-orchestrator.js")["Cs2SeriesOrchestrator"];
  let userRepository: typeof import("../../db/repositories/user.repository.js")["userRepository"];

  const arenaIds: string[] = [];
  const matchIds: string[] = [];
  const seriesIds: string[] = [];
  const userIds: string[] = [];
  const teamIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ seriesRepository } = await import("../../db/repositories/series.repository.js"));
    ({ arenaRepository } = await import("../../db/repositories/arena.repository.js"));
    ({ matchRepository } = await import("../../db/repositories/match.repository.js"));
    ({ cs2IdentityRepository } = await import("../../db/repositories/cs2-identity.repository.js"));
    ({ entryPassRepository } = await import("../../db/repositories/entry-pass.repository.js"));
    ({ predictionRoundRepository } = await import("../../db/repositories/prediction-round.repository.js"));
    ({ WriteQueue } = await import("../../gateway/stores/write-queue.js"));
    ({ Cs2SeriesOrchestrator } = await import("../series-orchestrator.js"));
    ({ userRepository } = await import("../../db/repositories/user.repository.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    for (const arenaId of arenaIds) {
      const rounds = await db
        .select({ id: schema.predictionRounds.id })
        .from(schema.predictionRounds)
        .where(eq(schema.predictionRounds.arenaId, arenaId));
      for (const round of rounds) {
        await db.delete(schema.predictions).where(eq(schema.predictions.roundId, round.id));
      }
      await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.arenaId, arenaId));
      await db.delete(schema.arenaPlayers).where(eq(schema.arenaPlayers.arenaId, arenaId));
      await db.delete(schema.entryPasses).where(eq(schema.entryPasses.arenaId, arenaId));
      await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    }
    for (const matchId of matchIds) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    for (const seriesId of seriesIds) await db.delete(schema.series).where(eq(schema.series.id, seriesId));
    for (const teamId of teamIds) await db.delete(schema.cs2Teams).where(eq(schema.cs2Teams.id, teamId));
    for (const userId of userIds) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function synchronizeTestTeams(seriesId: string): Promise<readonly [string, string]> {
    const suffix = randomUUID();
    const identities = await cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
      { gridTeamId: `grid-a-${suffix}`, name: "Team A", score: 0 },
      { gridTeamId: `grid-b-${suffix}`, name: "Team B", score: 0 },
    ]);
    const ids = [identities[0].teamId, identities[1].teamId] as const;
    teamIds.push(...ids);
    return ids;
  }

  it("opens Arena #1 in lobby, persists Round 1, flips to live on Match Live Detected, then cancels the reactively-opened Arena #2 on a forfeit — Series ends up decided, not invalid", async () => {
    const at = clockFrom(new Date(Date.now()).toISOString());
    const gridSeriesId = `int-test-${randomUUID()}`;
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, { format: 3, scheduledStartTime: new Date(at(0)) });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const openedArenas: { arenaId: string }[] = [];
    const orchestrator = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (arenaId) => openedArenas.push({ arenaId }),
    });

    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const matchesForSeries = (await matchRepository.list()).filter((m) => m.discipline === "cs2" && m.seriesId === series.id);
    expect(matchesForSeries).toHaveLength(1);
    const match1Id = matchesForSeries[0]!.id;
    matchIds.push(match1Id);
    const foundArena1 = await arenaRepository.findByMatchId(match1Id);
    expect(foundArena1).toBeDefined();
    const arena1Id = foundArena1!.id;
    arenaIds.push(arena1Id);
    expect(foundArena1?.status).toBe("lobby");
    expect(openedArenas).toEqual([{ arenaId: arena1Id }]);

    await writeQueue.drain();
    const roundsForArena1 = await predictionRoundRepository.listByArenaId(arena1Id);
    expect(roundsForArena1).toHaveLength(1);
    expect(roundsForArena1[0]).toMatchObject({ roundNumber: 1, status: "open" });

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(0));
    const arena1AfterMld = await arenaRepository.findById(arena1Id);
    expect(arena1AfterMld?.status).toBe("live");

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false, teams: [1, 0] }), at(20));
    const matchesAfterM1 = (await matchRepository.list()).filter((m) => m.discipline === "cs2" && m.seriesId === series.id);
    expect(matchesAfterM1).toHaveLength(2);
    const match2Id = matchesAfterM1.find((m) => m.id !== match1Id)!.id;
    matchIds.push(match2Id);
    const arena2 = await arenaRepository.findByMatchId(match2Id);
    expect(arena2?.status).toBe("lobby");
    arenaIds.push(arena2!.id);
    expect(openedArenas).toEqual([{ arenaId: arena1Id }, { arenaId: arena2!.id }]);

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

    // The series-score jump resolves a map that never appeared live.
    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false, teams: [2, 0], finished: true }), at(22));

    const cancelledArena2 = await arenaRepository.findById(arena2!.id);
    expect(cancelledArena2).toMatchObject({ status: "cancelled", cancelledReason: "series_decided" });

    const refundedPass = await entryPassRepository.listByArenaId(arena2!.id);
    expect(refundedPass.find((p) => p.id === entryPass.id)?.status).toBe("refunded");

    const decidedSeries = await seriesRepository.findById(series.id);
    expect(decidedSeries?.status).toBe("decided");
  });

  it("cancels Arena #1 with reason no_show and marks the Series invalid when Match Live Detected never arrives within 60min", async () => {
    const at = clockFrom(new Date(Date.now() + 3 * 60 * MIN).toISOString());
    const gridSeriesId = `int-test-${randomUUID()}`;
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, { format: 3, scheduledStartTime: new Date(at(0)) });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });

    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.list()).find((m) => m.discipline === "cs2" && m.seriesId === series.id)!;
    matchIds.push(match1.id);
    const arena1 = await arenaRepository.findByMatchId(match1.id);
    arenaIds.push(arena1!.id);

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false }), at(61));

    const cancelled = await arenaRepository.findById(arena1!.id);
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledReason: "no_show" });

    const invalidSeries = await seriesRepository.findById(series.id);
    expect(invalidSeries?.status).toBe("invalid");
  });

  it("restores the same lobby arena, round, roster, and answer without creating a duplicate match", async () => {
    const at = clockFrom(new Date(Date.now() + 6 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    let firstRuntime: Cs2ArenaRuntime | undefined;
    const first = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (_arenaId, runtime) => {
        firstRuntime = runtime;
      },
    });
    await first.poll(snapshot(matchTeamIds, {}), at(-10));

    const match = (await matchRepository.listBySeriesId(series.id))[0]!;
    const arena = (await arenaRepository.findByMatchId(match.id))!;
    matchIds.push(match.id);
    arenaIds.push(arena.id);

    const user = await userRepository.upsertByWallet(`int-test-wallet-${randomUUID()}`, "restart-player");
    userIds.push(user.id);
    firstRuntime!.join(user.id, user.username, at(-9));
    const originalRound = firstRuntime!.currentRound!;
    expect(firstRuntime!.submitAnswer(user.id, originalRound.id, "yes").ok).toBe(true);
    await writeQueue.drain();

    let restoredRuntime: Cs2ArenaRuntime | undefined;
    let restoredArenaId: string | undefined;
    await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (arenaId, runtime) => {
        restoredArenaId = arenaId;
        restoredRuntime = runtime;
      },
    });

    expect(restoredArenaId).toBe(arena.id);
    expect(restoredRuntime!.currentRound?.id).toBe(originalRound.id);
    expect(restoredRuntime!.statusFor(user.id)).toBe("active");
    expect(restoredRuntime!.answerFor(user.id, originalRound.id)).toBe("yes");
    expect(await matchRepository.listBySeriesId(series.id)).toHaveLength(1);
  });
});
