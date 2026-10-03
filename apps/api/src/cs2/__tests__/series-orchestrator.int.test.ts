import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cs2GameSnapshot, MatchSignal } from "@arena/contracts";
import type { Cs2ArenaRuntime } from "../arena-runtime.js";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

const pushMocks = vi.hoisted(() => ({ sendPushToUser: vi.fn() }));
vi.mock("../../push/service.js", () => ({ sendPushToUser: pushMocks.sendPushToUser }));

const MIN = 60_000;
function clockFrom(anchorIso: string): (offsetMinutes: number) => string {
  return (offsetMinutes: number) => new Date(Date.parse(anchorIso) + offsetMinutes * MIN).toISOString();
}

function snapshot(
  teamIds: readonly [string, string],
  opts: { teams?: [number, number]; hasLiveGame?: boolean; finished?: boolean; mapNames?: string[] },
): Cs2SeriesSnapshot {
  const [a, b] = opts.teams ?? [0, 0];
  return {
    format: 3,
    finished: opts.finished ?? false,
    hasLiveGame: opts.hasLiveGame ?? false,
    mapNames: opts.mapNames ?? [],
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
  let cs2SeriesFollowRepository: typeof import("../../db/repositories/cs2-series-follow.repository.js")["cs2SeriesFollowRepository"];
  let payoutService: typeof import("../../payout/index.js")["payoutService"];
  let arenaPlayerRepository: typeof import("../../db/repositories/arena-player.repository.js")["arenaPlayerRepository"];

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
    ({ cs2SeriesFollowRepository } = await import("../../db/repositories/cs2-series-follow.repository.js"));
    ({ payoutService } = await import("../../payout/index.js"));
    ({ arenaPlayerRepository } = await import("../../db/repositories/arena-player.repository.js"));
  });

  beforeEach(() => {
    pushMocks.sendPushToUser.mockReset();
    pushMocks.sendPushToUser.mockResolvedValue(undefined);
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
    const matchesForSeries = await matchRepository.listBySeriesId(series.id);
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
    const matchesAfterM1 = await matchRepository.listBySeriesId(series.id);
    expect(matchesAfterM1).toHaveLength(2);
    const match2Id = matchesAfterM1.find((m) => m.id !== match1Id)!.id;
    matchIds.push(match2Id);
    const arena2 = await arenaRepository.findByMatchId(match2Id);
    expect(arena2?.status).toBe("lobby");
    arenaIds.push(arena2!.id);
    expect(openedArenas).toEqual([{ arenaId: arena1Id }, { arenaId: arena2!.id }]);

    // The series-score jump resolves a map that never appeared live; it must hold for 2 polls.
    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false, teams: [2, 0], finished: true }), at(22));
    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false, teams: [2, 0], finished: true }), at(22.2));

    const cancelledArena2 = await arenaRepository.findById(arena2!.id);
    expect(cancelledArena2).toMatchObject({ status: "cancelled", cancelledReason: "series_decided" });

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

  it("keeps a no-show cancelled arena cancelled when the teams go live on the next poll", async () => {
    const at = clockFrom(new Date(Date.now() + 24 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);

    // The series-status write after cancelIfLobby fails, so the cancel doesn't commit.
    const seriesStatusSpy = vi.spyOn(seriesRepository, "setStatus").mockRejectedValueOnce(new Error("db unavailable"));
    try {
      await expect(orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false }), at(61))).rejects.toThrow("db unavailable");
    } finally {
      seriesStatusSpy.mockRestore();
    }
    expect(await arenaRepository.findById(arena1.id)).toMatchObject({ status: "cancelled", cancelledReason: "no_show" });

    // The teams go live: the cancelled arena must not.
    await expect(orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(61.2))).rejects.toThrow("no longer open");
    expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");
    expect((await matchRepository.findById(match1.id))?.status).toBe("scheduled");

    // Once the game is over, the no-show cancel is re-emitted and completes.
    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false }), at(90));
    expect((await seriesRepository.findById(series.id))?.status).toBe("invalid");
  });

  it("finishes a live arena on match end and settles its payout", async () => {
    const at = clockFrom(new Date(Date.now() + 27 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);
    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(1));

    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      orchestrator.currentBus()!.publish({ kind: "cs2_match_end", timestamp: at(40) });
      await writeQueue.drain();
      expect((await arenaRepository.findById(arena1.id))?.status).toBe("finished");
      expect(settleSpy).toHaveBeenCalledWith(arena1.id, []);
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("never finishes or pays a cancelled arena whose runtime still gets a match end", async () => {
    const at = clockFrom(new Date(Date.now() + 30 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);
    // Captured before the cancel: the runtime stays subscribed to it.
    const arena1Bus = orchestrator.currentBus()!;

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false }), at(61));
    expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");

    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      arena1Bus.publish({ kind: "cs2_match_end", timestamp: at(100) });
      await writeQueue.drain();
      expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");
      expect(settleSpy).not.toHaveBeenCalled();
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("stops feeding a no-show-cancelled arena when its game starts late", async () => {
    const at = clockFrom(new Date(Date.now() + 33 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: false }), at(61));
    expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");
    expect(orchestrator.currentBus()).toBeUndefined();

    // The late game, delivered the way Cs2LivePoller does: tracker signals go to currentBus().
    const game = (a: number, b: number): Cs2GameSnapshot => ({
      teams: [
        { teamId: matchTeamIds[0], name: "Team A", score: a, deaths: 0, weaponKills: [], players: [] },
        { teamId: matchTeamIds[1], name: "Team B", score: b, deaths: 0, weaponKills: [], players: [] },
      ],
      clock: { ticking: true, currentSeconds: 20 },
    });
    const deliver = (signal: MatchSignal) => orchestrator.currentBus()?.publish(signal);
    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(70));
      deliver({ kind: "cs2_round_lock", roundNumber: 1, timestamp: at(71) });
      deliver({ kind: "cs2_round_end", roundNumber: 1, snapshot: game(1, 0), timestamp: at(72) });
      deliver({ kind: "cs2_match_end", timestamp: at(120) });
      await writeQueue.drain();

      const rounds = await predictionRoundRepository.listByArenaId(arena1.id);
      expect(rounds.map((round) => round.roundNumber)).toEqual([1]);
      expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");
      expect(settleSpy).not.toHaveBeenCalled();
    } finally {
      settleSpy.mockRestore();
    }
  });

  // A live arena 1 as a crash leaves it: round 1 settled, round 2 locked, the given players joined.
  async function seedLiveArenaAtCrash(startInHours: number, players: { status: "active" | "eliminated"; paid?: boolean }[]) {
    const at = clockFrom(new Date(Date.now() + startInHours * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    let runtime: Cs2ArenaRuntime | undefined;
    const first = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (_arenaId, opened) => {
        runtime = opened;
      },
    });
    await first.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena.id);

    const users = [];
    for (const [i, player] of players.entries()) {
      const user = await userRepository.upsertByWallet(`int-test-wallet-${randomUUID()}`, `crash-player-${i}`);
      userIds.push(user.id);
      runtime!.join(user.id, user.username, at(-9));
      users.push({ ...user, ...player });
    }
    await first.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(1));
    await writeQueue.drain();
    expect((await arenaRepository.findById(arena.id))?.status).toBe("live");

    for (const user of users) {
      if (user.status === "eliminated") await arenaPlayerRepository.setStatus(arena.id, user.id, "eliminated");
      if (user.paid === true) {
        await entryPassRepository.create({
          arenaId: arena.id,
          userId: user.id,
          walletAddress: user.walletAddress,
          amountLamports: 1000,
          txSignature: `int-test-tx-${randomUUID()}`,
        });
      }
    }
    const round1 = (await predictionRoundRepository.listByArenaId(arena.id))[0]!;
    const settledRound1 = await predictionRoundRepository.upsert({ ...round1, status: "settled", settledAt: at(5) });
    const lockedRound2 = await predictionRoundRepository.upsert({
      ...round1,
      id: randomUUID(),
      roundNumber: 2,
      status: "locked",
      lockedAt: at(6),
    });

    return { at, series, matchTeamIds, match1, arena, users, settledRound1, lockedRound2 };
  }

  it("crash-closes a live arena on restore: voids unsettled rounds and pays the active players", async () => {
    const seeded = await seedLiveArenaAtCrash(36, [{ status: "active" }, { status: "active" }, { status: "eliminated" }]);
    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      await Cs2SeriesOrchestrator.create(seeded.series, { writeQueue: new WriteQueue(), entryFeeLamports: 1000 });

      const rounds = await predictionRoundRepository.listByArenaId(seeded.arena.id);
      expect(rounds.find((round) => round.id === seeded.lockedRound2.id)?.status).toBe("voided");
      expect(rounds.find((round) => round.id === seeded.settledRound1.id)).toEqual(seeded.settledRound1);

      const statuses = Object.fromEntries(
        (await arenaPlayerRepository.list(seeded.arena.id)).map((player) => [player.userId, player.status]),
      );
      expect(statuses).toEqual({
        [seeded.users[0]!.id]: "winner",
        [seeded.users[1]!.id]: "winner",
        [seeded.users[2]!.id]: "eliminated",
      });
      expect((await arenaRepository.findById(seeded.arena.id))?.status).toBe("finished");
      expect(settleSpy).toHaveBeenCalledTimes(1);
      expect(settleSpy.mock.calls[0]![0]).toBe(seeded.arena.id);
      expect([...settleSpy.mock.calls[0]![1]].sort()).toEqual([seeded.users[0]!.id, seeded.users[1]!.id].sort());
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("continues the series after a crash close: map 1's end opens arena 2 and finishes match 1", async () => {
    const seeded = await seedLiveArenaAtCrash(39, [{ status: "active" }]);
    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      const writeQueue = new WriteQueue();
      const restored = await Cs2SeriesOrchestrator.create(seeded.series, { writeQueue, entryFeeLamports: 1000 });
      await restored.poll(snapshot(seeded.matchTeamIds, { hasLiveGame: true }), seeded.at(20));
      expect(await matchRepository.listBySeriesId(seeded.series.id)).toHaveLength(1);

      await restored.poll(snapshot(seeded.matchTeamIds, { teams: [1, 0] }), seeded.at(40));
      const match2 = (await matchRepository.listBySeriesId(seeded.series.id)).find((m) => m.id !== seeded.match1.id)!;
      matchIds.push(match2.id);
      const arena2 = (await arenaRepository.findByMatchId(match2.id))!;
      arenaIds.push(arena2.id);

      expect(arena2.status).toBe("lobby");
      expect((await matchRepository.findById(seeded.match1.id))?.status).toBe("finished");
      expect((await seriesRepository.findById(seeded.series.id))?.status).toBe("active");
      await writeQueue.drain();
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("refuses to follow the next map as the crash-closed one when it is already live at the first poll", async () => {
    const seeded = await seedLiveArenaAtCrash(45, [{ status: "active" }]);
    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      const restored = await Cs2SeriesOrchestrator.create(seeded.series, { writeQueue: new WriteQueue(), entryFeeLamports: 1000 });

      await expect(
        restored.poll(snapshot(seeded.matchTeamIds, { teams: [1, 0], hasLiveGame: true }), seeded.at(50)),
      ).rejects.toThrow("already live");
      await expect(
        restored.poll(snapshot(seeded.matchTeamIds, { teams: [1, 0], hasLiveGame: true }), seeded.at(51)),
      ).rejects.toThrow("already live");
      expect(await matchRepository.listBySeriesId(seeded.series.id)).toHaveLength(1);
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("leaves a live arena live on restore when it has paid entries but no active player", async () => {
    const seeded = await seedLiveArenaAtCrash(42, [{ status: "eliminated", paid: true }]);
    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      await Cs2SeriesOrchestrator.create(seeded.series, { writeQueue: new WriteQueue(), entryFeeLamports: 1000 });

      expect((await arenaRepository.findById(seeded.arena.id))?.status).toBe("live");
      expect(settleSpy).not.toHaveBeenCalled();
    } finally {
      settleSpy.mockRestore();
    }
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

  it("persists map names from a poll's snapshot onto the Series", async () => {
    const at = clockFrom(new Date(Date.now() + 9 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });

    await orchestrator.poll(snapshot(matchTeamIds, { mapNames: ["mirage"] }), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);
    expect((await seriesRepository.findById(series.id))).toBeDefined();
    const [afterFirstPoll] = await db.select({ mapNames: schema.series.mapNames }).from(schema.series).where(eq(schema.series.id, series.id));
    expect(afterFirstPoll?.mapNames).toEqual(["mirage"]);

    await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true, mapNames: ["mirage", "inferno"] }), at(0));
    const [afterSecondPoll] = await db.select({ mapNames: schema.series.mapNames }).from(schema.series).where(eq(schema.series.id, series.id));
    expect(afterSecondPoll?.mapNames).toEqual(["mirage", "inferno"]);
  });

  it("pushes every series follower when an arena opens, addressed to the arena that just opened — and sends nothing when there are no followers", async () => {
    const at = clockFrom(new Date(Date.now() + 12 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const follower = await userRepository.upsertByWallet(`int-test-wallet-${randomUUID()}`, "follower");
    userIds.push(follower.id);
    await cs2SeriesFollowRepository.follow(follower.id, series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });

    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);

    await vi.waitFor(() => expect(pushMocks.sendPushToUser).toHaveBeenCalledTimes(1));
    expect(pushMocks.sendPushToUser).toHaveBeenCalledWith(
      follower.id,
      expect.objectContaining({ url: `/cs2/arena/${arena1.id}` }),
    );
  });

  it("does not reopen an arena when a poll retries after a later action failed", async () => {
    const at = clockFrom(new Date(Date.now() + 18 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const follower = await userRepository.upsertByWallet(`int-test-wallet-${randomUUID()}`, "follower");
    userIds.push(follower.id);
    await cs2SeriesFollowRepository.follow(follower.id, series.id);

    const writeQueue = new WriteQueue();
    const openedArenas: { arenaId: string }[] = [];
    const orchestrator = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (arenaId) => openedArenas.push({ arenaId }),
    });

    // The first poll lands mid-game: [open_arena(1), match_live_detected(1)], and the second action fails.
    const setStatusSpy = vi.spyOn(arenaRepository, "setLiveIfOpen").mockRejectedValueOnce(new Error("db unavailable"));
    try {
      await expect(orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(5))).rejects.toThrow("db unavailable");
      await orchestrator.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(5.2));
    } finally {
      setStatusSpy.mockRestore();
    }

    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);
    expect(arena1.status).toBe("live");
    expect(openedArenas).toEqual([{ arenaId: arena1.id }]);

    await writeQueue.drain();
    const rounds = await predictionRoundRepository.listByArenaId(arena1.id);
    expect(rounds.filter((round) => round.roundNumber === 1)).toHaveLength(1);

    await vi.waitFor(() => expect(pushMocks.sendPushToUser).toHaveBeenCalledTimes(1));
  });

  it("does not block or fail arena opening when the push send throws", async () => {
    const at = clockFrom(new Date(Date.now() + 15 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const follower = await userRepository.upsertByWallet(`int-test-wallet-${randomUUID()}`, "follower");
    userIds.push(follower.id);
    await cs2SeriesFollowRepository.follow(follower.id, series.id);
    pushMocks.sendPushToUser.mockRejectedValue(new Error("push provider unreachable"));

    const writeQueue = new WriteQueue();
    const openedArenas: { arenaId: string }[] = [];
    const orchestrator = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: 1000,
      onArenaOpened: (arenaId) => openedArenas.push({ arenaId }),
    });

    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));

    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = await arenaRepository.findByMatchId(match1.id);
    expect(arena1).toBeDefined();
    arenaIds.push(arena1!.id);
    expect(arena1?.status).toBe("lobby");
    expect(openedArenas).toEqual([{ arenaId: arena1!.id }]);
  });

  it("cancels a forfeited, never-live map as forfeit and runs the next map in a fresh arena", async () => {
    const at = clockFrom(new Date(Date.now() + 21 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);

    await orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15));
    expect((await arenaRepository.findById(arena1.id))?.status).toBe("lobby");
    await orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15.2));

    expect(await arenaRepository.findById(arena1.id)).toMatchObject({ status: "cancelled", cancelledReason: "forfeit" });

    const match2 = (await matchRepository.listBySeriesId(series.id)).find((m) => m.id !== match1.id)!;
    matchIds.push(match2.id);
    const arena2 = (await arenaRepository.findByMatchId(match2.id))!;
    arenaIds.push(arena2.id);
    expect(arena2.status).toBe("lobby");
    // Arena 1 is detached, so the current bus can only be arena 2's.
    expect(orchestrator.currentBus()).toBeDefined();

    await orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0], hasLiveGame: true }), at(20));
    expect((await arenaRepository.findById(arena2.id))?.status).toBe("live");
    expect((await arenaRepository.findById(arena1.id))?.status).toBe("cancelled");
    expect((await seriesRepository.findById(series.id))?.status).toBe("active");
    await writeQueue.drain();
  });

  it("still opens the next arena when a forfeit cancel fails once", async () => {
    const at = clockFrom(new Date(Date.now() + 27 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const orchestrator = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await orchestrator.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);

    const cancelSpy = vi.spyOn(arenaRepository, "cancelIfLobby").mockRejectedValueOnce(new Error("db unavailable"));
    try {
      await orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15));
      await expect(orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15.2))).rejects.toThrow(
        "db unavailable",
      );
      expect((await arenaRepository.findById(arena1.id))?.status).toBe("lobby");

      await orchestrator.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15.4));
    } finally {
      cancelSpy.mockRestore();
    }

    expect(await arenaRepository.findById(arena1.id)).toMatchObject({ status: "cancelled", cancelledReason: "forfeit" });
    const match2 = (await matchRepository.listBySeriesId(series.id)).find((m) => m.id !== match1.id)!;
    matchIds.push(match2.id);
    const arena2 = (await arenaRepository.findByMatchId(match2.id))!;
    arenaIds.push(arena2.id);
    expect(arena2.status).toBe("lobby");
    await writeQueue.drain();
  });

  it("does not no-show a restored lobby Arena #2 by measuring from the Series' scheduled start", async () => {
    const at = clockFrom(new Date(Date.now() + 24 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const first = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await first.poll(snapshot(matchTeamIds, {}), at(-10));
    await first.poll(snapshot(matchTeamIds, { hasLiveGame: true }), at(0));
    await first.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(90));
    const matches = await matchRepository.listBySeriesId(series.id);
    expect(matches).toHaveLength(2);
    matchIds.push(...matches.map((m) => m.id));
    for (const m of matches) arenaIds.push((await arenaRepository.findByMatchId(m.id))!.id);
    await writeQueue.drain();

    const restored = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await restored.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(100));

    const match2 = matches.find((m) => m.discipline === "cs2" && m.seriesMatchIndex === 2)!;
    expect((await arenaRepository.findByMatchId(match2.id))?.status).toBe("lobby");
    expect((await seriesRepository.findById(series.id))?.status).toBe("active");
  });

  it("restores over a forfeit-cancelled arena without ending the Series", async () => {
    const at = clockFrom(new Date(Date.now() + 18 * 60 * MIN).toISOString());
    const series = await seriesRepository.upsertByGridSeriesId(`int-test-${randomUUID()}`, {
      format: 3,
      scheduledStartTime: new Date(at(0)),
    });
    seriesIds.push(series.id);
    const matchTeamIds = await synchronizeTestTeams(series.id);

    const writeQueue = new WriteQueue();
    const first = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    await first.poll(snapshot(matchTeamIds, {}), at(-10));
    const match1 = (await matchRepository.listBySeriesId(series.id))[0]!;
    matchIds.push(match1.id);
    const arena1 = (await arenaRepository.findByMatchId(match1.id))!;
    arenaIds.push(arena1.id);
    await writeQueue.drain();

    // Simulates a crash after the forfeit cancellation committed but before the next arena opened.
    expect(await arenaRepository.cancelIfLobby(arena1.id, "forfeit")).toBeDefined();

    const restored = await Cs2SeriesOrchestrator.create(series, { writeQueue, entryFeeLamports: 1000 });
    expect((await seriesRepository.findById(series.id))?.status).toBe("active");

    await restored.poll(snapshot(matchTeamIds, {}), at(1));
    expect((await seriesRepository.findById(series.id))?.status).toBe("active");
    expect(await matchRepository.listBySeriesId(series.id)).toHaveLength(1);

    // Self-heal: the still-visible forfeit score re-drives the cancel (a no-op now) and opens map 2.
    await restored.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15));
    await restored.poll(snapshot(matchTeamIds, { teams: [1, 0] }), at(15.2));
    const match2 = (await matchRepository.listBySeriesId(series.id)).find((m) => m.id !== match1.id)!;
    matchIds.push(match2.id);
    const arena2 = (await arenaRepository.findByMatchId(match2.id))!;
    arenaIds.push(arena2.id);

    await restored.poll(snapshot(matchTeamIds, { teams: [1, 0], hasLiveGame: true }), at(20));
    expect((await arenaRepository.findById(arena2.id))?.status).toBe("live");
    expect((await seriesRepository.findById(series.id))?.status).toBe("active");
    await writeQueue.drain();
  });
});
