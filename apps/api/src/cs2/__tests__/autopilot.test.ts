import type { Series } from "@arena/contracts";
import { describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({ getActiveCs2TournamentId: vi.fn() }));

vi.mock("../../db/repositories/cs2-catalog.repository.js", () => ({ cs2CatalogRepository: {} }));
vi.mock("../../db/repositories/series.repository.js", () => ({ seriesRepository: {} }));
vi.mock("../../db/repositories/settings.repository.js", () => ({
  CS2_AUTOPILOT_SETTING: "cs2_autopilot",
  settingsRepository: { getActiveCs2TournamentId: settingsMocks.getActiveCs2TournamentId },
}));
vi.mock("../series-runner.js", () => ({ Cs2SeriesRunner: {} }));
vi.mock("../catalog-synchronizer.js", () => ({ synchronizeCs2Catalog: vi.fn() }));

const { Cs2Autopilot, runCs2CatalogSync } = await import("../autopilot.js");
type Deps = import("../autopilot.js").Cs2AutopilotDeps;
type StartInput = Parameters<Deps["startRunner"]>[0];

const NOW = new Date("2026-10-04T09:00:00.000Z");

function series(id: string, startInMinutes: number): Series {
  return {
    id,
    gridSeriesId: `grid-${id}`,
    format: 3,
    scheduledStartTime: new Date(NOW.getTime() + startInMinutes * 60_000).toISOString(),
    status: "active",
    priority: false,
    skipRequested: false,
  };
}

function candidateOf(s: Series) {
  return {
    seriesId: s.id,
    scheduledStartTime: s.scheduledStartTime,
    priority: false,
    followerCount: 0,
    selectable: true,
    status: "active" as const,
    hasArena: false,
    skipRequested: false,
    format: 3,
  };
}

class FakeRunner {
  stopped = false;
  skipResult: "skipped" | "refused" = "skipped";
  skipCalls = 0;
  async skip() {
    this.skipCalls += 1;
    return this.skipResult;
  }
  constructor(
    readonly seriesId: string,
    readonly gridSeriesId: string,
    private readonly arenaIds: string[] = [],
  ) {}
  openedArenaIds() {
    return this.arenaIds;
  }
  async stopPolling() {}
  async stop() {
    this.stopped = true;
  }
}

function setup(options: { enabled?: boolean; series?: Series[]; startResult?: "started" | "skipped"; arenaIds?: string[] } = {}) {
  const all = options.series ?? [series("s1", 5)];
  const starts: StartInput[] = [];
  const runners: FakeRunner[] = [];
  const skipped: string[] = [];
  const released: string[] = [];
  const deps: Deps = {
    startRunner: vi.fn(async (input: StartInput) => {
      starts.push(input);
      if (options.startResult === "skipped") return { kind: "skipped" as const, reason: "already_started" };
      const s = all.find((item) => item.gridSeriesId === input.gridSeriesId)!;
      const runner = new FakeRunner(s.id, s.gridSeriesId, options.arenaIds);
      runners.push(runner);
      return { kind: "started" as const, runner };
    }),
    isEnabled: async () => options.enabled ?? true,
    listCandidates: async () => all.map(candidateOf),
    listActiveRunSeries: async () => [],
    findSeries: async (id) => all.find((s) => s.id === id),
    setSeriesSkipped: async (id) => {
      skipped.push(id);
    },
    releaseArena: (id) => {
      released.push(id);
    },
    now: () => NOW,
    random: () => 0,
  };
  return { autopilot: new Cs2Autopilot(deps), deps, starts, runners, skipped, released };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("Cs2Autopilot.tick", () => {
  it("starts exactly one runner for a launchable series, with a priming deadline 30 min after its start", async () => {
    const { autopilot, starts } = setup();
    await autopilot.tick();
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      gridSeriesId: "grid-s1",
      scheduledStartTime: series("s1", 5).scheduledStartTime,
      primingDeadline: series("s1", 35).scheduledStartTime,
    });
  });

  it("starts nothing while a runner is running", async () => {
    const { autopilot, starts } = setup();
    await autopilot.tick();
    await autopilot.tick();
    expect(starts).toHaveLength(1);
  });

  it("starts nothing when the switch is off", async () => {
    const { autopilot, starts } = setup({ enabled: false });
    await autopilot.tick();
    expect(starts).toEqual([]);
  });

  it("starts nothing while the next series is still more than 10 min away", async () => {
    const { autopilot, starts } = setup({ series: [series("s1", 11)] });
    await autopilot.tick();
    expect(starts).toEqual([]);
  });

  it("keeps no runner when priming skips the series, so the next tick can launch again", async () => {
    const { autopilot, starts } = setup({ startResult: "skipped" });
    await autopilot.tick();
    await autopilot.tick();
    expect(starts).toHaveLength(2);
  });

  it("drops a completed runner and lets the next tick launch again", async () => {
    const { autopilot, starts, runners, skipped } = setup({ arenaIds: ["arena-1", "arena-2"] });
    await autopilot.tick();
    starts[0]!.onEnd("complete");
    await settle();
    await autopilot.tick();

    expect(runners[0]!.stopped).toBe(true);
    expect(skipped).toEqual([]);
    expect(starts).toHaveLength(2);
  });

  it("keeps the last finished series' arenas in memory until the next series ends, then releases them", async () => {
    const { autopilot, starts, released } = setup({ arenaIds: ["arena-1", "arena-2"] });
    await autopilot.tick();
    starts[0]!.onEnd("complete");
    await settle();
    expect(released).toEqual([]);

    await autopilot.tick();
    starts[1]!.onEnd("complete");
    await settle();
    expect(released).toEqual(["arena-1", "arena-2"]);
  });

  it("drops the runner even when stopping it fails, so later launches aren't blocked", async () => {
    const { autopilot, starts, runners } = setup();
    await autopilot.tick();
    runners[0]!.stop = async () => {
      throw new Error("unlock failed");
    };
    starts[0]!.onEnd("complete");
    await settle();
    await autopilot.tick();
    expect(starts).toHaveLength(2);
  });

  it("resumes a series with an open arena before picking a new one, even with the switch off", async () => {
    const { autopilot, deps, starts } = setup({ enabled: false, series: [series("s1", -20), series("s2", 5)] });
    deps.listActiveRunSeries = async () => [
      { seriesId: "s1", gridSeriesId: "grid-s1", scheduledStartTime: series("s1", -20).scheduledStartTime, hasOpenArena: true },
    ];
    await autopilot.tick();
    expect(starts.map((start) => start.gridSeriesId)).toEqual(["grid-s1"]);
    expect(starts[0]!.primingDeadline).toBeUndefined();
  });

  it("skips the series and drops the runner when the next map was already live after a crash close", async () => {
    const { autopilot, starts, runners, skipped } = setup({ arenaIds: ["arena-1"] });
    await autopilot.tick();
    starts[0]!.onEnd("overtaken");
    await settle();

    expect(runners[0]!.stopped).toBe(true);
    expect(skipped).toEqual(["s1"]);
  });

  it("logs and keeps no runner when starting throws (e.g. the lock is taken)", async () => {
    const { autopilot, deps } = setup();
    vi.mocked(deps.startRunner).mockRejectedValueOnce(new Error("lock taken"));
    await autopilot.tick();
    await autopilot.tick();
    expect(deps.startRunner).toHaveBeenCalledTimes(2);
  });
});

describe("Cs2Autopilot.resume", () => {
  it("restarts the series with an open arena, without a priming deadline", async () => {
    const { autopilot, deps, starts } = setup();
    deps.listActiveRunSeries = async () => [
      { seriesId: "s1", gridSeriesId: "grid-s1", scheduledStartTime: series("s1", -20).scheduledStartTime, hasOpenArena: true },
    ];
    await autopilot.resume();
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ gridSeriesId: "grid-s1" });
    expect(starts[0]!.primingDeadline).toBeUndefined();

    await autopilot.tick();
    expect(starts).toHaveLength(1);
  });

  it("doesn't launch a second runner when a tick already resumed the series", async () => {
    const { autopilot, deps, starts } = setup({ series: [series("s1", -20)] });
    deps.listActiveRunSeries = async () => [
      { seriesId: "s1", gridSeriesId: "grid-s1", scheduledStartTime: series("s1", -20).scheduledStartTime, hasOpenArena: true },
    ];
    await autopilot.tick();
    await autopilot.resume();
    expect(starts).toHaveLength(1);
  });

  it("starts nothing when no series ran", async () => {
    const { autopilot, starts } = setup({ enabled: false });
    await autopilot.resume();
    expect(starts).toEqual([]);
  });

  it("skips a series that died between maps and starts no runner for it", async () => {
    const { autopilot, deps, starts, skipped } = setup({ enabled: false });
    deps.listActiveRunSeries = async () => [
      { seriesId: "s1", gridSeriesId: "grid-s1", scheduledStartTime: series("s1", -90).scheduledStartTime, hasOpenArena: false },
    ];
    await autopilot.resume();
    expect(skipped).toEqual(["s1"]);
    expect(starts).toEqual([]);
  });
});

describe("Cs2Autopilot shutdown", () => {
  it("stops the running runner", async () => {
    const { autopilot, runners } = setup();
    await autopilot.tick();
    await autopilot.stop();
    expect(runners[0]!.stopped).toBe(true);
  });

  it("launches nothing once shutdown began", async () => {
    const { autopilot, starts } = setup();
    await autopilot.stopPolling();
    await autopilot.tick();
    expect(starts).toEqual([]);
  });
});

describe("Cs2Autopilot series-end notification", () => {
  it("notifies once when a running series ends, so a catalog sync can be queued", async () => {
    const { autopilot, starts } = setup();
    const listener = vi.fn();
    autopilot.onSeriesEnded(listener);
    await autopilot.tick();
    expect(listener).not.toHaveBeenCalled();
    starts[0]!.onEnd("complete");
    await settle();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifies when priming skips the series", async () => {
    const { autopilot } = setup({ startResult: "skipped" });
    const listener = vi.fn();
    autopilot.onSeriesEnded(listener);
    await autopilot.tick();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("runCs2CatalogSync", () => {
  const now = new Date("2026-10-04T09:00:00.000Z");

  it("doesn't sync while a series runs (one GRID budget)", async () => {
    const synchronize = vi.fn();
    await runCs2CatalogSync({ hasRunner: true }, { synchronize, now, tournamentIds: ["830797"] });
    expect(synchronize).not.toHaveBeenCalled();
  });

  it("syncs the configured tournaments over the discovery window when idle", async () => {
    const synchronize = vi.fn().mockResolvedValue({ discovered: 0, persisted: 0, supported: 0, incompleteParticipants: 0, withdrawn: 0 });
    await runCs2CatalogSync({ hasRunner: false }, { synchronize, now, tournamentIds: ["830797"] });
    expect(synchronize).toHaveBeenCalledOnce();
    const [window, options] = synchronize.mock.calls[0]!;
    expect(options).toEqual({ now, tournamentIds: ["830797"] });
    expect(window.from.getTime()).toBeLessThan(now.getTime());
    expect(window.to.getTime()).toBeGreaterThan(now.getTime());
  });

  it("reads the active tournament from the database when none is supplied", async () => {
    settingsMocks.getActiveCs2TournamentId.mockResolvedValueOnce("830797");
    const synchronize = vi.fn().mockResolvedValue({ discovered: 0, persisted: 0, supported: 0, incompleteParticipants: 0, withdrawn: 0 });
    await runCs2CatalogSync({ hasRunner: false }, { synchronize, now });
    expect(synchronize).toHaveBeenCalledWith(expect.any(Object), { now, tournamentIds: ["830797"] });
  });

  it("logs a failed sync instead of throwing", async () => {
    const synchronize = vi.fn().mockRejectedValue(new Error("GRID down"));
    await expect(runCs2CatalogSync({ hasRunner: false }, { synchronize, now, tournamentIds: ["830797"] })).resolves.toBeUndefined();
  });
});

describe("Cs2Autopilot.hasRunner", () => {
  it("is true while a launched series is still priming, so the catalog sync stays off GRID", async () => {
    const { autopilot, deps } = setup();
    let finishPriming: () => void = () => {};
    vi.mocked(deps.startRunner).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishPriming = () => resolve({ kind: "skipped", reason: "already_started" });
      }),
    );
    const tick = autopilot.tick();
    await settle();
    expect(autopilot.hasRunner).toBe(true);
    finishPriming();
    await tick;
    expect(autopilot.hasRunner).toBe(false);
  });
});

describe("Cs2Autopilot.runWhileIdle", () => {
  it("accepts operator work immediately after the queue becomes idle", async () => {
    const { autopilot } = setup({ enabled: false });
    await autopilot.tick();
    const task = vi.fn().mockResolvedValue("published");

    await expect(autopilot.runWhileIdle(task)).resolves.toEqual({ kind: "completed", value: "published" });
    expect(task).toHaveBeenCalledOnce();
  });

  it("returns busy instead of queuing operator work behind an in-flight tick", async () => {
    const { autopilot, deps } = setup({ enabled: false });
    let finishRuntimeRead: () => void = () => {};
    deps.listActiveRunSeries = () => new Promise((resolve) => {
      finishRuntimeRead = () => resolve([]);
    });
    const tick = autopilot.tick();
    await settle();
    const task = vi.fn().mockResolvedValue(undefined);
    const result = autopilot.runWhileIdle(task);

    finishRuntimeRead();
    await tick;

    await expect(result).resolves.toEqual({ kind: "busy" });
    expect(task).not.toHaveBeenCalled();
  });
});

describe("Cs2Autopilot operator skip", () => {
  it("skips the running series on the next tick when the operator requested it, and frees the slot", async () => {
    const all = [series("s1", 5), series("s2", 5)];
    const { autopilot, starts, runners } = setup({ series: all });
    const listener = vi.fn();
    autopilot.onSeriesEnded(listener);
    await autopilot.tick();
    all[0]!.skipRequested = true;

    await autopilot.tick();
    expect(runners[0]!.skipCalls).toBe(1);
    expect(runners[0]!.stopped).toBe(true);
    expect(autopilot.hasRunner).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(starts).toHaveLength(1);
  });

  it("keeps the runner when the skip is refused", async () => {
    const all = [series("s1", 5)];
    const { autopilot, runners } = setup({ series: all });
    await autopilot.tick();
    runners[0]!.skipResult = "refused";
    all[0]!.skipRequested = true;

    await autopilot.tick();
    expect(runners[0]!.skipCalls).toBe(1);
    expect(runners[0]!.stopped).toBe(false);
    expect(autopilot.hasRunner).toBe(true);
  });

  it("does nothing to a running series without a skip request", async () => {
    const { autopilot, runners } = setup();
    await autopilot.tick();
    await autopilot.tick();
    expect(runners[0]!.skipCalls).toBe(0);
  });
});
