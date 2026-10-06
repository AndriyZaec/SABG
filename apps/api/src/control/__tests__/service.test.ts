import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OperatorControlDependencies } from "../service.js";
import { OperatorControlService } from "../service.js";

function setup(overrides: Partial<OperatorControlDependencies> = {}) {
  const release = vi.fn().mockResolvedValue(undefined);
  const runWhileIdleCalls = vi.fn();
  const runWhileIdle: OperatorControlDependencies["runWhileIdle"] = async (task) => {
    runWhileIdleCalls();
    return { kind: "completed", value: await task() };
  };
  const deps = {
    getActiveTournamentId: vi.fn().mockResolvedValue("old-tournament"),
    setActiveTournamentId: vi.fn().mockResolvedValue(undefined),
    isAutopilotEnabled: vi.fn().mockResolvedValue(true),
    setAutopilotEnabled: vi.fn().mockResolvedValue(undefined),
    readRuntimeState: vi.fn().mockResolvedValue({ runningSeriesIds: [], unfinishedArenaCount: 0 }),
    hasRunner: vi.fn().mockReturnValue(false),
    runWhileIdle,
    listCatalog: vi.fn().mockResolvedValue([]),
    getRunningSeriesId: vi.fn().mockReturnValue(undefined),
    findSeries: vi.fn().mockResolvedValue({
      id: randomUUID(),
      status: "active" as const,
      priority: false,
      skipRequested: false,
      streamUrl: null,
    }),
    setSeriesPriority: vi.fn().mockResolvedValue(true),
    setSeriesStream: vi.fn().mockResolvedValue(true),
    requestSeriesSkip: vi.fn().mockResolvedValue(true),
    hasPaidEntry: vi.fn().mockResolvedValue(false),
    acquirePublishLock: vi.fn().mockResolvedValue(release),
    appendAudit: vi.fn().mockResolvedValue(undefined),
    listAudits: vi.fn().mockResolvedValue([]),
    discover: vi.fn().mockResolvedValue({ window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" }, series: [] }),
    inspect: vi.fn().mockResolvedValue({ window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" }, series: [] }),
    activate: vi.fn().mockResolvedValue({
      tournamentId: "new-tournament",
      seriesId: "series-1",
      scheduledStartTime: new Date("2026-01-01T00:00:00.000Z"),
      syncedSeries: 2,
    }),
    ...overrides,
  } satisfies OperatorControlDependencies;
  return { service: new OperatorControlService(deps, "test-revision"), deps, release, runWhileIdleCalls };
}

const actor = { id: "123", login: "operator" };

describe("operator control safety", () => {
  it("refuses skip when the Series has a paid entry", async () => {
    const { service, deps } = setup({ hasPaidEntry: vi.fn().mockResolvedValue(true) });

    await expect(service.mutate(
      { type: "series.skip.request", gridSeriesId: "series-1" },
      actor,
      randomUUID(),
    )).resolves.toEqual({ result: { status: "refused", reason: "Series has paid entries" } });
    expect(deps.requestSeriesSkip).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "refused" }));
  });

  it("refuses publish while a CS2 Arena is unfinished", async () => {
    const { service, deps, release } = setup({
      readRuntimeState: vi.fn().mockResolvedValue({ runningSeriesIds: [], unfinishedArenaCount: 1 }),
    });

    await expect(service.mutate(
      { type: "tournament.publish", gridTournamentId: "new-tournament", gridSeriesId: "series-1" },
      actor,
      randomUUID(),
    )).resolves.toEqual({
      result: { status: "refused", reason: "An unfinished CS2 Arena exists; Skip it or wait for it to finish" },
    });
    expect(deps.activate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns a conflict when another publication holds the lock", async () => {
    const { service, deps } = setup({ acquirePublishLock: vi.fn().mockResolvedValue(undefined) });

    await expect(service.mutate(
      { type: "tournament.publish", gridTournamentId: "new-tournament", gridSeriesId: "series-1" },
      actor,
      randomUUID(),
    )).resolves.toEqual({
      conflict: true,
      result: { status: "refused", reason: "Another tournament publication is running" },
    });
    expect(deps.activate).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "refused" }));
  });

  it("publishes through the database setting and audits the result", async () => {
    const { service, deps, release, runWhileIdleCalls } = setup();
    const requestId = randomUUID();

    await expect(service.mutate(
      { type: "tournament.publish", gridTournamentId: "new-tournament", gridSeriesId: "series-1" },
      actor,
      requestId,
    )).resolves.toEqual({ result: { status: "succeeded" } });
    expect(deps.activate).toHaveBeenCalledWith("series-1", "new-tournament");
    expect(runWhileIdleCalls).toHaveBeenCalledOnce();
    expect(deps.setActiveTournamentId).toHaveBeenCalledWith("new-tournament");
    expect(deps.appendAudit).toHaveBeenCalledWith({
      actorId: "123",
      actorLogin: "operator",
      action: "tournament.publish",
      targetId: "new-tournament",
      result: "succeeded",
      requestId,
      details: { before: "old-tournament", after: "new-tournament" },
    });
    expect(release).toHaveBeenCalledOnce();
  });
});
