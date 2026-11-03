import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OperatorControlDependencies } from "../service.js";
import { OperatorControlService } from "../service.js";

function fakeLeaderboard(overrides: Partial<OperatorControlDependencies["leaderboard"]> = {}): OperatorControlDependencies["leaderboard"] {
  return {
    listScopes: vi.fn().mockResolvedValue([]),
    findScope: vi.fn().mockResolvedValue(undefined),
    findCurrent: vi.fn().mockResolvedValue(undefined),
    createScope: vi.fn().mockResolvedValue(undefined),
    renameScope: vi.fn().mockResolvedValue(true),
    setCurrent: vi.fn().mockResolvedValue("switched"),
    closeCurrent: vi.fn().mockResolvedValue(true),
    addCompetition: vi.fn().mockResolvedValue(true),
    removeCompetition: vi.fn().mockResolvedValue(true),
    competitionExists: vi.fn().mockResolvedValue(true),
    listAdminCompetitions: vi.fn().mockResolvedValue([]),
    topEntries: vi.fn().mockResolvedValue([]),
    recomputeScope: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

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
    leaderboard: fakeLeaderboard(),
    queueLeaderboardRecompute: vi.fn().mockReturnValue(true),
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

describe("operator control leaderboard", () => {
  const scope = (id: string, overrides: Record<string, unknown> = {}) =>
    ({ id, name: `Scope ${id}`, status: "open" as const, isCurrent: false, closedAt: null, createdAt: new Date("2026-10-27T00:00:00.000Z"), ...overrides });

  it("refuses to make a closed scope current again", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("old", { status: "closed", closedAt: new Date() })) });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.scope.current.set", scopeId: "old" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
    expect(leaderboard.setCurrent).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "leaderboard.scope.current.set", targetId: "old", result: "refused" }));
  });

  it("recomputes the previous current scope one last time before switching", async () => {
    const leaderboard = fakeLeaderboard({
      findScope: vi.fn().mockResolvedValue(scope("next")),
      findCurrent: vi.fn().mockResolvedValue(scope("prev", { isCurrent: true })),
    });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.scope.current.set", scopeId: "next" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.recomputeScope).toHaveBeenCalledExactlyOnceWith("prev");
    expect(vi.mocked(leaderboard.recomputeScope).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(leaderboard.setCurrent).mock.invocationCallOrder[0]!);
    expect(leaderboard.setCurrent).toHaveBeenCalledWith("next", "prev");
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "succeeded", details: { before: "prev", after: "next" } }));
  });

  it("closes the current scope after its final recompute, and refuses when there is none", async () => {
    const leaderboard = fakeLeaderboard({ findCurrent: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })) });
    const { service } = setup({ leaderboard });
    await expect(service.mutate({ type: "leaderboard.scope.close" }, actor, randomUUID())).resolves.toEqual({ result: { status: "succeeded" } });
    expect(vi.mocked(leaderboard.recomputeScope).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(leaderboard.closeCurrent).mock.invocationCallOrder[0]!);
    expect(leaderboard.closeCurrent).toHaveBeenCalledWith("live");

    const empty = setup();
    await expect(empty.service.mutate({ type: "leaderboard.scope.close" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "No current scope" } });
    expect(empty.deps.leaderboard.closeCurrent).not.toHaveBeenCalled();
  });

  it("refuses a switch or close when another operator changed the current scope meanwhile", async () => {
    const reason = "Current scope changed; reload and try again";
    const leaderboard = fakeLeaderboard({
      findScope: vi.fn().mockResolvedValue(scope("next")),
      findCurrent: vi.fn().mockResolvedValue(scope("prev", { isCurrent: true })),
      setCurrent: vi.fn().mockResolvedValue("current_changed"),
      closeCurrent: vi.fn().mockResolvedValue(false),
    });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.scope.current.set", scopeId: "next" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason } });
    await expect(service.mutate({ type: "leaderboard.scope.close" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason } });
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "leaderboard.scope.current.set", result: "refused", details: { reason } }));
    expect(deps.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "leaderboard.scope.close", result: "refused", details: { reason } }));
  });

  it("refuses to change a closed scope's competitions but still renames it", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("old", { status: "closed", closedAt: new Date() })) });
    const { service } = setup({ leaderboard });

    for (const type of ["leaderboard.competition.add", "leaderboard.competition.remove"] as const) {
      await expect(service.mutate({ type, scopeId: "old", competitionId: "c1" }, actor, randomUUID()))
        .resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
    }
    expect(leaderboard.addCompetition).not.toHaveBeenCalled();
    expect(leaderboard.removeCompetition).not.toHaveBeenCalled();

    await expect(service.mutate({ type: "leaderboard.scope.rename", scopeId: "old", name: "Spring" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.renameScope).toHaveBeenCalledWith("old", "Spring");
  });

  it("adds and removes a competition without recomputing, and refuses an unknown one", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("open")) });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.competition.add", scopeId: "open", competitionId: "c1" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.addCompetition).toHaveBeenCalledWith("open", "c1");
    expect(leaderboard.recomputeScope).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({ details: { after: "c1" } }));

    await expect(service.mutate({ type: "leaderboard.competition.remove", scopeId: "open", competitionId: "c1" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({ details: { before: "c1", after: null } }));

    vi.mocked(leaderboard.competitionExists).mockResolvedValue(false);
    await expect(service.mutate({ type: "leaderboard.competition.remove", scopeId: "open", competitionId: "nope" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Competition not found" } });
  });

  it("queues a recompute of the current scope, and refuses without one or before the queue runs", async () => {
    const leaderboard = fakeLeaderboard({ findCurrent: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })) });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.recompute" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "requested" } });
    expect(deps.queueLeaderboardRecompute).toHaveBeenCalledOnce();
    expect(leaderboard.recomputeScope).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "leaderboard.recompute", result: "requested", details: { after: "live" } }));

    vi.mocked(deps.queueLeaderboardRecompute).mockReturnValue(false);
    await expect(service.mutate({ type: "leaderboard.recompute" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Recompute queue is not running" } });

    const empty = setup();
    await expect(empty.service.mutate({ type: "leaderboard.recompute" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "No current scope" } });
    expect(empty.deps.queueLeaderboardRecompute).not.toHaveBeenCalled();
  });

  it("reports scopes, competitions with the unfinished flag, and the current top", async () => {
    const computedAt = new Date("2026-10-27T12:00:00.000Z");
    const leaderboard = fakeLeaderboard({
      listScopes: vi.fn().mockResolvedValue([scope("past", { status: "closed", closedAt: computedAt }), scope("live", { isCurrent: true })]),
      listAdminCompetitions: vi.fn().mockResolvedValue([
        { id: "c1", name: "Cup", shortName: null, logoUrl: null, scopeIds: ["live"], arenasWithResults: 3, unfinished: true },
      ]),
      topEntries: vi.fn().mockResolvedValue([{
        userId: "u1", username: "ace", avatar: null, rank: 1, points: 12, arenasPlayed: 2, wins: 1, secondPlaces: 1,
        roundsPlayed: 30, totalScore: 12, totalPayoutLamports: 900, computedAt,
      }]),
    });
    const { service } = setup({ leaderboard });

    expect(await service.leaderboard()).toEqual({
      scopes: [
        { id: "past", name: "Scope past", status: "closed", current: false, closedAt: computedAt.toISOString() },
        { id: "live", name: "Scope live", status: "open", current: true },
      ],
      competitions: [{ id: "c1", name: "Cup", scopeIds: ["live"], arenasWithResults: 3, unfinished: true }],
      current: {
        scopeId: "live",
        computedAt: computedAt.toISOString(),
        entries: [{ userId: "u1", username: "ace", rank: 1, points: 12, wins: 1, secondPlaces: 1, roundsPlayed: 30, arenasPlayed: 2, totalPayoutLamports: 900 }],
      },
    });
    expect(leaderboard.topEntries).toHaveBeenCalledWith("live", 100);
  });
});
