import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cs2SeriesRunner } from "../series-runner.js";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

vi.mock("../../push/service.js", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));

const MIN = 60_000;

function rawSeries(gridIds: readonly [string, string], opts: { format: string; teams: [number, number]; live: boolean }) {
  return {
    data: {
      seriesState: {
        format: opts.format,
        finished: false,
        teams: [
          { id: gridIds[0], name: "Team A", score: opts.teams[0], won: false },
          { id: gridIds[1], name: "Team B", score: opts.teams[1], won: false },
        ],
        games: opts.live
          ? [
              {
                clock: { ticking: true, currentSeconds: 90 },
                teams: [
                  { id: gridIds[0], name: "Team A", score: 3, deaths: 0, weaponKills: [], players: [] },
                  { id: gridIds[1], name: "Team B", score: 2, deaths: 0, weaponKills: [], players: [] },
                ],
              },
            ]
          : [],
      },
    },
  };
}

describe.skipIf(!RUN)("Cs2SeriesRunner (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let tryAcquireSeriesRuntimeLock: typeof import("../../db/client.js")["tryAcquireSeriesRuntimeLock"];
  let seriesRepository: typeof import("../../db/repositories/series.repository.js")["seriesRepository"];
  let matchRepository: typeof import("../../db/repositories/match.repository.js")["matchRepository"];
  let arenaRepository: typeof import("../../db/repositories/arena.repository.js")["arenaRepository"];
  let cs2IdentityRepository: typeof import("../../db/repositories/cs2-identity.repository.js")["cs2IdentityRepository"];
  let WriteQueue: typeof import("../../gateway/stores/write-queue.js")["WriteQueue"];
  let GatewayWebSocketServer: typeof import("../../gateway/ws.js")["GatewayWebSocketServer"];
  let Cs2SeriesRunner: typeof import("../series-runner.js")["Cs2SeriesRunner"];
  let Cs2SeriesOrchestrator: typeof import("../series-orchestrator.js")["Cs2SeriesOrchestrator"];
  let payoutService: typeof import("../../payout/index.js")["payoutService"];

  const gridSeriesIds: string[] = [];
  const runners: Cs2SeriesRunner[] = [];

  beforeAll(async () => {
    ({ db, tryAcquireSeriesRuntimeLock } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ seriesRepository } = await import("../../db/repositories/series.repository.js"));
    ({ matchRepository } = await import("../../db/repositories/match.repository.js"));
    ({ arenaRepository } = await import("../../db/repositories/arena.repository.js"));
    ({ cs2IdentityRepository } = await import("../../db/repositories/cs2-identity.repository.js"));
    ({ WriteQueue } = await import("../../gateway/stores/write-queue.js"));
    ({ GatewayWebSocketServer } = await import("../../gateway/ws.js"));
    ({ Cs2SeriesRunner } = await import("../series-runner.js"));
    ({ Cs2SeriesOrchestrator } = await import("../series-orchestrator.js"));
    ({ payoutService } = await import("../../payout/index.js"));
  });

  afterAll(async () => {
    for (const runner of runners) await runner.stop();
    if (db === undefined) return;
    for (const gridSeriesId of gridSeriesIds) {
      const series = await seriesRepository.findByGridSeriesId(gridSeriesId);
      if (series === undefined) continue;
      for (const match of await matchRepository.listBySeriesId(series.id)) {
        const arena = await arenaRepository.findByMatchId(match.id);
        if (arena !== undefined) {
          await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.arenaId, arena.id));
          await db.delete(schema.arenas).where(eq(schema.arenas.id, arena.id));
        }
        await db.delete(schema.matches).where(eq(schema.matches.id, match.id));
      }
      const teams = await db
        .select({ teamId: schema.cs2SeriesParticipants.teamId })
        .from(schema.cs2SeriesParticipants)
        .where(eq(schema.cs2SeriesParticipants.seriesId, series.id));
      await db.delete(schema.series).where(eq(schema.series.id, series.id));
      for (const { teamId } of teams) await db.delete(schema.cs2Teams).where(eq(schema.cs2Teams.id, teamId));
    }
  });

  function newSeries() {
    const gridSeriesId = `int-test-${randomUUID()}`;
    gridSeriesIds.push(gridSeriesId);
    const suffix = randomUUID();
    return { gridSeriesId, gridIds: [`grid-a-${suffix}`, `grid-b-${suffix}`] as const };
  }

  async function start(
    gridSeriesId: string,
    raw: unknown,
    extra: { primingDeadline?: string; onEnd?: (outcome: "complete" | "overtaken") => void } = {},
  ) {
    const result = await Cs2SeriesRunner.start({
      ...extra,
      gridSeriesId,
      scheduledStartTime: new Date(Date.now() + 60 * MIN).toISOString(),
      wsGateway: new GatewayWebSocketServer(),
      writeQueue: new WriteQueue(),
      entryFeeLamports: 1000,
      rawRecordingEnabled: false,
      signal: new AbortController().signal,
      gridClient: { fetchSeriesState: async () => ({ data: raw, status: 200, headers: {} }) },
    });
    if (result.kind === "started") runners.push(result.runner);
    return result;
  }

  async function expectLockFree(gridSeriesId: string) {
    const release = await tryAcquireSeriesRuntimeLock(gridSeriesId);
    expect(release).toBeDefined();
    await release!();
  }

  it("skips a series that is already 1:0 on its first launch, creates nothing and releases the lock", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    const result = await start(gridSeriesId, rawSeries(gridIds, { format: "best-of-3", teams: [1, 0], live: false }));

    expect(result).toEqual({ kind: "skipped", reason: "already_started" });
    const series = (await seriesRepository.findByGridSeriesId(gridSeriesId))!;
    expect(series.status).toBe("skipped");
    expect(await matchRepository.listBySeriesId(series.id)).toEqual([]);
    await expectLockFree(gridSeriesId);
  });

  it("joins a 0:0 Bo3 with map 1 live without opening arena 1", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    const result = await start(gridSeriesId, rawSeries(gridIds, { format: "best-of-3", teams: [0, 0], live: true }));

    expect(result.kind).toBe("started");
    if (result.kind !== "started") return;
    await result.runner.stop();
    expect(await matchRepository.listBySeriesId(result.runner.seriesId)).toEqual([]);
    expect((await seriesRepository.findById(result.runner.seriesId))?.status).toBe("active");
  });

  it("starts an idle 0:0 series as today and holds its lock until stopped", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    const result = await start(gridSeriesId, rawSeries(gridIds, { format: "best-of-3", teams: [0, 0], live: false }));

    expect(result.kind).toBe("started");
    if (result.kind !== "started") return;
    expect(result.runner.gridSeriesId).toBe(gridSeriesId);
    expect(await tryAcquireSeriesRuntimeLock(gridSeriesId)).toBeUndefined();
    await result.runner.stop();
    await expectLockFree(gridSeriesId);
  });

  it("resumes a series with a live arena despite a 1:0 score and crash-closes that arena", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(Date.now() - 30 * MIN),
    });
    const teams = await cs2IdentityRepository.synchronizeSeriesTeams(series.id, [
      { gridTeamId: gridIds[0], name: "Team A", score: 0 },
      { gridTeamId: gridIds[1], name: "Team B", score: 0 },
    ]);
    const match = await matchRepository.upsertForSeriesMap(series.id, 1, { teams, startTime: new Date() });
    const arena = await arenaRepository.upsertForMatch(match.id, { entryFeeLamports: 1000, prizePoolLamports: 0 });
    expect(await arenaRepository.setLiveIfOpen(arena.id)).toBeDefined();

    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      const result = await start(gridSeriesId, rawSeries(gridIds, { format: "best-of-3", teams: [1, 0], live: false }));

      expect(result.kind).toBe("started");
      expect((await seriesRepository.findById(series.id))?.status).toBe("active");
      expect((await arenaRepository.findById(arena.id))?.status).toBe("finished");
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("skips a series with no series state once the priming deadline passes, and releases the lock", async () => {
    const { gridSeriesId } = newSeries();
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(Date.now() - 31 * MIN),
    });

    const result = await start(gridSeriesId, { data: { seriesState: null } }, {
      primingDeadline: new Date(Date.now() + 200).toISOString(),
    });

    expect(result).toEqual({ kind: "skipped", reason: "no_series_state" });
    expect((await seriesRepository.findById(series.id))?.status).toBe("skipped");
    await expectLockFree(gridSeriesId);
  });

  it("reports overtaken when the map after a crash-closed one is already live", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(Date.now() - 60 * MIN),
    });
    const teams = await cs2IdentityRepository.synchronizeSeriesTeams(series.id, [
      { gridTeamId: gridIds[0], name: "Team A", score: 0 },
      { gridTeamId: gridIds[1], name: "Team B", score: 0 },
    ]);
    const match = await matchRepository.upsertForSeriesMap(series.id, 1, { teams, startTime: new Date() });
    const arena = await arenaRepository.upsertForMatch(match.id, { entryFeeLamports: 1000, prizePoolLamports: 0 });
    expect(await arenaRepository.setLiveIfOpen(arena.id)).toBeDefined();

    const settleSpy = vi.spyOn(payoutService, "settleArena").mockResolvedValue(undefined);
    try {
      const ended = new Promise<string>((resolve) => {
        void start(gridSeriesId, rawSeries(gridIds, { format: "best-of-3", teams: [1, 0], live: true }), { onEnd: resolve });
      });
      await expect(ended).resolves.toBe("overtaken");
      expect((await arenaRepository.findById(arena.id))?.status).toBe("finished");
    } finally {
      settleSpy.mockRestore();
    }
  });

  it("keeps polling when an operator skip throws partway", async () => {
    const { gridSeriesId, gridIds } = newSeries();
    let fetches = 0;
    const raw = rawSeries(gridIds, { format: "best-of-3", teams: [0, 0], live: false });
    const result = await Cs2SeriesRunner.start({
      gridSeriesId,
      scheduledStartTime: new Date(Date.now() + 60 * MIN).toISOString(),
      wsGateway: new GatewayWebSocketServer(),
      writeQueue: new WriteQueue(),
      entryFeeLamports: 1000,
      rawRecordingEnabled: false,
      signal: new AbortController().signal,
      gridClient: {
        fetchSeriesState: async () => {
          fetches += 1;
          return { data: raw, status: 200, headers: {} };
        },
      },
    });
    expect(result.kind).toBe("started");
    if (result.kind !== "started") return;
    runners.push(result.runner);

    const skipSpy = vi.spyOn(Cs2SeriesOrchestrator.prototype, "skip").mockRejectedValueOnce(new Error("rpc down"));
    try {
      // The poll interval is far longer than this test, so a new fetch can only come from a restarted poller.
      await vi.waitFor(() => expect(fetches).toBe(2));
      await expect(result.runner.skip()).rejects.toThrow("rpc down");
      await vi.waitFor(() => expect(fetches).toBe(3));
    } finally {
      skipSpy.mockRestore();
    }
  });
});

