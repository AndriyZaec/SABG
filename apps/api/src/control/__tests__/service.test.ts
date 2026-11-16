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
    listScopeCompetitionSummaries: vi.fn().mockResolvedValue([]),
    topEntries: vi.fn().mockResolvedValue([]),
    listPrizes: vi.fn().mockResolvedValue([]),
    listAllPrizes: vi.fn().mockResolvedValue([]),
    setPrize: vi.fn().mockResolvedValue(true),
    removePrize: vi.fn().mockResolvedValue(true),
    userExists: vi.fn().mockResolvedValue(true),
    listMarks: vi.fn().mockResolvedValue([]),
    listMarkDrafts: vi.fn().mockResolvedValue([]),
    setMarkDraft: vi.fn().mockResolvedValue(true),
    removeMarkDraft: vi.fn().mockResolvedValue(true),
    applyMarkDrafts: vi.fn().mockResolvedValue(1),
    listPrizeClaims: vi.fn().mockResolvedValue([]),
    markPrizeSent: vi.fn().mockResolvedValue({ kind: "not_found" }),
    finalizeScope: vi.fn().mockResolvedValue({ kind: "finalized", claims: 1 }),
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
    ({ id, name: `Scope ${id}`, status: "open" as const, isCurrent: false, closedAt: null, finalizedAt: null, createdAt: new Date("2026-10-27T00:00:00.000Z"), ...overrides });

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

  it("sets, replaces and removes a prize with the image before and after in the audit", async () => {
    const imageUrl = "https://cdn.example.com/skins/awp.png";
    const leaderboard = fakeLeaderboard({
      findScope: vi.fn().mockResolvedValue(scope("open")),
      listPrizes: vi.fn().mockResolvedValue([{ place: 2, imageUrl: "https://cdn.example.com/skins/old.png" }]),
    });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.prize.set", scopeId: "open", place: 1, imageUrl }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.setPrize).toHaveBeenCalledWith("open", 1, imageUrl);
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.prize.set", targetId: "open", result: "succeeded", details: { before: null, after: imageUrl },
    }));

    await expect(service.mutate({ type: "leaderboard.prize.set", scopeId: "open", place: 2, imageUrl }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      details: { before: "https://cdn.example.com/skins/old.png", after: imageUrl },
    }));

    await expect(service.mutate({ type: "leaderboard.prize.remove", scopeId: "open", place: 2 }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.removePrize).toHaveBeenCalledWith("open", 2);
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.prize.remove", details: { before: "https://cdn.example.com/skins/old.png", after: null },
    }));
  });

  it("refuses prize changes on a missing or closed scope, and when the scope closes before the write", async () => {
    const imageUrl = "https://cdn.example.com/skins/awp.png";
    const missing = setup();
    await expect(missing.service.mutate({ type: "leaderboard.prize.set", scopeId: "nope", place: 1, imageUrl }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope not found" } });

    const closed = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("old", { status: "closed", closedAt: new Date() })) });
    const { service } = setup({ leaderboard: closed });
    await expect(service.mutate({ type: "leaderboard.prize.set", scopeId: "old", place: 1, imageUrl }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
    await expect(service.mutate({ type: "leaderboard.prize.remove", scopeId: "old", place: 1 }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
    expect(closed.setPrize).not.toHaveBeenCalled();
    expect(closed.removePrize).not.toHaveBeenCalled();

    const racing = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("open")), setPrize: vi.fn().mockResolvedValue(false) });
    const raced = setup({ leaderboard: racing });
    await expect(raced.service.mutate({ type: "leaderboard.prize.set", scopeId: "open", place: 1, imageUrl }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
  });

  it("stages mark drafts with the actor and audits them against the scope and player", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("open", { isCurrent: true })) });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.mark.draft.set", scopeId: "open", userId: "u1", action: "disqualify", reason: "Second account" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.setMarkDraft).toHaveBeenCalledWith("open", "u1", "disqualify", "Second account", actor.login);
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.mark.draft.set", targetId: "open:u1", result: "succeeded", details: { before: null, after: "disqualify" },
    }));

    vi.mocked(leaderboard.listMarkDrafts).mockResolvedValue([
      { userId: "u1", action: "disqualify", reason: "Second account", actorLogin: actor.login, updatedAt: new Date() },
    ]);
    await expect(service.mutate({ type: "leaderboard.mark.draft.set", scopeId: "open", userId: "u1", action: "approve" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.setMarkDraft).toHaveBeenLastCalledWith("open", "u1", "approve", null, actor.login);
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({ details: { before: "disqualify", after: "approve" } }));

    await expect(service.mutate({ type: "leaderboard.mark.draft.remove", scopeId: "open", userId: "u1" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.removeMarkDraft).toHaveBeenCalledWith("open", "u1");
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.mark.draft.remove", details: { before: "disqualify", after: null },
    }));
    expect(deps.queueLeaderboardRecompute).not.toHaveBeenCalled();
  });

  it("lifts only an applied mark", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("open", { isCurrent: true })) });
    const { service } = setup({ leaderboard });
    const clear = () => service.mutate({ type: "leaderboard.mark.draft.set", scopeId: "open", userId: "u1", action: "clear" }, actor, randomUUID());

    await expect(clear()).resolves.toEqual({ result: { status: "refused", reason: "No mark to clear" } });
    expect(leaderboard.setMarkDraft).not.toHaveBeenCalled();

    vi.mocked(leaderboard.listMarks).mockResolvedValue([{ userId: "u1", status: "disqualified", reason: "Second account", appliedAt: new Date() }]);
    await expect(clear()).resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.setMarkDraft).toHaveBeenCalledWith("open", "u1", "clear", null, actor.login);
  });

  it("refuses a mark draft with a wrong reason, an unknown player, or a missing, closed or not current scope", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("open", { isCurrent: true })) });
    const { service } = setup({ leaderboard });
    const draft = (action: "approve" | "disqualify" | "clear", reason?: string) =>
      service.mutate({ type: "leaderboard.mark.draft.set", scopeId: "open", userId: "u1", action, ...(reason !== undefined ? { reason } : {}) }, actor, randomUUID());

    await expect(draft("disqualify")).resolves.toEqual({ result: { status: "refused", reason: "A disqualification needs a reason" } });
    await expect(draft("approve", "Looks fine")).resolves.toEqual({ result: { status: "refused", reason: "Only a disqualification takes a reason" } });
    await expect(draft("clear", "Lifted")).resolves.toEqual({ result: { status: "refused", reason: "Only a disqualification takes a reason" } });
    vi.mocked(leaderboard.userExists).mockResolvedValue(false);
    await expect(draft("approve")).resolves.toEqual({ result: { status: "refused", reason: "Player not found" } });
    expect(leaderboard.setMarkDraft).not.toHaveBeenCalled();

    const missing = setup();
    await expect(missing.service.mutate({ type: "leaderboard.mark.draft.remove", scopeId: "nope", userId: "u1" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Scope not found" } });

    const closed = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("old", { status: "closed", closedAt: new Date() })) });
    const closedSetup = setup({ leaderboard: closed });
    for (const command of [
      { type: "leaderboard.mark.draft.set", scopeId: "old", userId: "u1", action: "approve" },
      { type: "leaderboard.mark.draft.remove", scopeId: "old", userId: "u1" },
      { type: "leaderboard.marks.apply", scopeId: "old" },
    ] as const) {
      await expect(closedSetup.service.mutate(command, actor, randomUUID())).resolves.toEqual({ result: { status: "refused", reason: "Scope is closed" } });
    }
    expect(closed.applyMarkDrafts).not.toHaveBeenCalled();

    const prepared = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("next")) });
    const preparedSetup = setup({ leaderboard: prepared });
    for (const command of [
      { type: "leaderboard.mark.draft.set", scopeId: "next", userId: "u1", action: "approve" },
      { type: "leaderboard.mark.draft.remove", scopeId: "next", userId: "u1" },
      { type: "leaderboard.marks.apply", scopeId: "next" },
    ] as const) {
      await expect(preparedSetup.service.mutate(command, actor, randomUUID())).resolves.toEqual({ result: { status: "refused", reason: "Scope is not current" } });
    }
    expect(prepared.setMarkDraft).not.toHaveBeenCalled();
    expect(prepared.applyMarkDrafts).not.toHaveBeenCalled();
    expect(preparedSetup.deps.queueLeaderboardRecompute).not.toHaveBeenCalled();
  });

  it("applies every staged mark at once, audits the count, and queues a recompute", async () => {
    const leaderboard = fakeLeaderboard({
      findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })),
      listMarkDrafts: vi.fn().mockResolvedValue([
        { userId: "u1", action: "disqualify", reason: "Second account", actorLogin: actor.login, updatedAt: new Date() },
        { userId: "u2", action: "approve", reason: null, actorLogin: actor.login, updatedAt: new Date() },
      ]),
      applyMarkDrafts: vi.fn().mockResolvedValue(2),
    });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.marks.apply", scopeId: "live" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.applyMarkDrafts).toHaveBeenCalledWith("live");
    expect(leaderboard.recomputeScope).not.toHaveBeenCalled();
    expect(vi.mocked(deps.queueLeaderboardRecompute).mock.invocationCallOrder.at(-1))
      .toBeGreaterThan(vi.mocked(leaderboard.applyMarkDrafts).mock.invocationCallOrder[0]!);
    expect(deps.appendAudit).toHaveBeenCalledOnce();
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.marks.apply", targetId: "live", result: "succeeded", details: { after: 2 },
    }));
  });

  it("refuses to apply with no drafts or before the recompute queue runs, leaving the drafts staged", async () => {
    const leaderboard = fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })) });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.marks.apply", scopeId: "live" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "No changes to apply" } });

    vi.mocked(leaderboard.listMarkDrafts).mockResolvedValue([
      { userId: "u1", action: "approve", reason: null, actorLogin: actor.login, updatedAt: new Date() },
    ]);
    vi.mocked(deps.queueLeaderboardRecompute).mockReturnValue(false);
    await expect(service.mutate({ type: "leaderboard.marks.apply", scopeId: "live" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "refused", reason: "Recompute queue is not running" } });
    expect(leaderboard.applyMarkDrafts).not.toHaveBeenCalled();
  });

  it("finalizes the current scope and audits the claims given out", async () => {
    const leaderboard = fakeLeaderboard({
      findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })),
      listPrizes: vi.fn().mockResolvedValue([{ place: 1, imageUrl: "https://cdn.example.com/skins/awp.png" }]),
      finalizeScope: vi.fn().mockResolvedValue({ kind: "finalized", claims: 1 }),
    });
    const { service, deps } = setup({ leaderboard });

    await expect(service.mutate({ type: "leaderboard.scope.finalize", scopeId: "live" }, actor, randomUUID()))
      .resolves.toEqual({ result: { status: "succeeded" } });
    // The final recompute runs inside finalize, under the lock marks are applied under.
    expect(leaderboard.finalizeScope).toHaveBeenCalledWith("live");
    expect(leaderboard.recomputeScope).not.toHaveBeenCalled();
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.scope.finalize", targetId: "live", result: "succeeded", details: { before: "live", after: 1 },
    }));
  });

  it("refuses to finalize a scope that isn't current, has no prizes, or has staged changes", async () => {
    const prize = { place: 1, imageUrl: "https://cdn.example.com/skins/awp.png" };
    const finalize = (service: OperatorControlService) => service.mutate({ type: "leaderboard.scope.finalize", scopeId: "live" }, actor, randomUUID());
    const cases = [
      [fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("live")) }), "Scope is not current"],
      [fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("live", { status: "closed", closedAt: new Date() })) }), "Scope is closed"],
      [fakeLeaderboard({ findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })) }), "Scope has no prizes"],
      [fakeLeaderboard({
        findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })),
        listPrizes: vi.fn().mockResolvedValue([prize]),
        listMarkDrafts: vi.fn().mockResolvedValue([{ userId: "u1", action: "approve", reason: null, actorLogin: actor.login, updatedAt: new Date() }]),
      }), "Apply or remove the staged mark changes first"],
    ] as const;
    for (const [leaderboard, reason] of cases) {
      const { service } = setup({ leaderboard });
      await expect(finalize(service)).resolves.toEqual({ result: { status: "refused", reason } });
      expect(leaderboard.finalizeScope).not.toHaveBeenCalled();
    }
  });

  it("refuses to finalize when the locked check finds unapproved prize players or a changed scope", async () => {
    for (const [outcome, reason] of [
      [{ kind: "unapproved", usernames: ["ace", "bolt"] }, "Prize players need an approval: ace, bolt"],
      [{ kind: "current_changed" }, "Current scope changed; reload and try again"],
      [{ kind: "drafts_pending" }, "Apply or remove the staged mark changes first"],
      [{ kind: "no_prizes" }, "Scope has no prizes"],
    ] as const) {
      const leaderboard = fakeLeaderboard({
        findScope: vi.fn().mockResolvedValue(scope("live", { isCurrent: true })),
        listPrizes: vi.fn().mockResolvedValue([{ place: 1, imageUrl: "https://cdn.example.com/skins/awp.png" }]),
        finalizeScope: vi.fn().mockResolvedValue(outcome),
      });
      const { service } = setup({ leaderboard });
      await expect(service.mutate({ type: "leaderboard.scope.finalize", scopeId: "live" }, actor, randomUUID()))
        .resolves.toEqual({ result: { status: "refused", reason } });
    }
  });

  it("marks a prize sent with only the place and dates in the audit, and refuses an unknown claim or a missing trade URL", async () => {
    const sentAt = new Date("2026-02-10T12:00:00.000Z");
    const leaderboard = fakeLeaderboard({ markPrizeSent: vi.fn().mockResolvedValue({ kind: "sent", sentAt, previous: null }) });
    const { service, deps } = setup({ leaderboard });
    const mark = (place: number) => service.mutate({ type: "leaderboard.prize.sent", scopeId: "iem", place }, actor, randomUUID());

    await expect(mark(1)).resolves.toEqual({ result: { status: "succeeded" } });
    expect(leaderboard.markPrizeSent).toHaveBeenCalledWith("iem", 1);
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "leaderboard.prize.sent", targetId: "iem:1", result: "succeeded", details: { before: null, after: sentAt.toISOString() },
    }));

    vi.mocked(leaderboard.markPrizeSent).mockResolvedValue({ kind: "sent", sentAt, previous: sentAt });
    await expect(mark(1)).resolves.toEqual({ result: { status: "succeeded" } });
    expect(deps.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      details: { before: sentAt.toISOString(), after: sentAt.toISOString() },
    }));

    vi.mocked(leaderboard.markPrizeSent).mockResolvedValue({ kind: "not_found" });
    await expect(mark(9)).resolves.toEqual({ result: { status: "refused", reason: "Prize claim not found" } });
    vi.mocked(leaderboard.markPrizeSent).mockResolvedValue({ kind: "no_trade_url" });
    await expect(mark(2)).resolves.toEqual({ result: { status: "refused", reason: "Winner has not sent a trade URL yet" } });
  });

  it("lists a finalized scope's winners, and none for scopes that weren't finalized", async () => {
    const at = new Date("2026-02-08T12:00:00.000Z");
    const claim = {
      scopeId: "iem", place: 1, userId: "u1", username: "ace", walletAddress: "Wallet1", imageUrl: "https://cdn.example.com/skins/awp.png",
      tradeUrl: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc", tradeUrlUpdatedAt: at, sentAt: null, tradeUrlErasedAt: null,
    };
    const leaderboard = fakeLeaderboard({
      listScopes: vi.fn().mockResolvedValue([
        scope("iem", { status: "closed", closedAt: at, finalizedAt: at }),
        scope("closed", { status: "closed", closedAt: at }),
        scope("open"),
      ]),
      listPrizeClaims: vi.fn().mockResolvedValue([claim, { ...claim, place: 2, userId: "u2", username: "bolt", tradeUrl: null, tradeUrlUpdatedAt: null, sentAt: at, tradeUrlErasedAt: at }]),
    });
    const { service } = setup({ leaderboard });

    const { scopes } = await service.leaderboard();
    expect(leaderboard.listPrizeClaims).toHaveBeenCalledWith(["iem"]);
    expect(scopes.map((row) => [row.id, row.winners])).toEqual([
      ["iem", [
        { place: 1, userId: "u1", username: "ace", walletAddress: "Wallet1", imageUrl: claim.imageUrl, tradeUrl: claim.tradeUrl, tradeUrlUpdatedAt: at.toISOString() },
        { place: 2, userId: "u2", username: "bolt", walletAddress: "Wallet1", imageUrl: claim.imageUrl, sentAt: at.toISOString(), tradeUrlErasedAt: at.toISOString() },
      ]],
      ["closed", undefined],
      ["open", undefined],
    ]);
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
    const prize = { place: 1, imageUrl: "https://cdn.example.com/skins/awp.png" };
    const leaderboard = fakeLeaderboard({
      listScopes: vi.fn().mockResolvedValue([scope("past", { status: "closed", closedAt: computedAt, finalizedAt: computedAt }), scope("live", { isCurrent: true })]),
      listAllPrizes: vi.fn().mockResolvedValue([{ scopeId: "live", ...prize }]),
      listMarks: vi.fn().mockResolvedValue([{ userId: "u1", status: "disqualified", reason: "Second account", appliedAt: computedAt }]),
      listMarkDrafts: vi.fn().mockResolvedValue([{ userId: "u2", action: "approve", reason: null, actorLogin: "operator", updatedAt: computedAt }]),
      listAdminCompetitions: vi.fn().mockResolvedValue([
        { id: "c1", name: "Cup", shortName: null, logoUrl: null, scopeIds: ["live"], arenasWithResults: 3, unfinished: true },
      ]),
      listScopeCompetitionSummaries: vi.fn().mockResolvedValue([{ scopeId: "live", competitionCount: 12, unfinishedCompetitions: ["Cup", "Old Cup"] }]),
      topEntries: vi.fn().mockResolvedValue([{
        userId: "u1", username: "ace", avatar: null, rank: 1, points: 12, arenasPlayed: 2, wins: 1, secondPlaces: 1,
        roundsPlayed: 30, totalScore: 12, totalPayoutLamports: 900, disqualified: false, computedAt,
      }, {
        userId: "u3", username: "cheat", avatar: null, rank: 2, points: 10, arenasPlayed: 2, wins: 0, secondPlaces: 1,
        roundsPlayed: 30, totalScore: 10, totalPayoutLamports: 0, disqualified: true, computedAt,
      }]),
    });
    const { service } = setup({ leaderboard });

    expect(await service.leaderboard()).toEqual({
      scopes: [
        { id: "past", name: "Scope past", status: "closed", current: false, closedAt: computedAt.toISOString(), finalizedAt: computedAt.toISOString(), competitionCount: 0, unfinishedCompetitions: [], prizes: [], winners: [] },
        { id: "live", name: "Scope live", status: "open", current: true, competitionCount: 12, unfinishedCompetitions: ["Cup", "Old Cup"], prizes: [prize] },
      ],
      competitions: [{ id: "c1", name: "Cup", scopeIds: ["live"], arenasWithResults: 3, unfinished: true }],
      current: {
        scopeId: "live",
        computedAt: computedAt.toISOString(),
        entries: [
          { userId: "u1", username: "ace", rank: 1, points: 12, wins: 1, secondPlaces: 1, roundsPlayed: 30, arenasPlayed: 2, totalPayoutLamports: 900, disqualified: false, prizePlace: 1 },
          { userId: "u3", username: "cheat", rank: 2, points: 10, wins: 0, secondPlaces: 1, roundsPlayed: 30, arenasPlayed: 2, totalPayoutLamports: 0, disqualified: true },
        ],
        marks: [{ userId: "u1", status: "disqualified", reason: "Second account", appliedAt: computedAt.toISOString() }],
        drafts: [{ userId: "u2", action: "approve", actorLogin: "operator", updatedAt: computedAt.toISOString() }],
      },
    });
    expect(leaderboard.topEntries).toHaveBeenCalledWith("live", 100);
    expect(leaderboard.listAdminCompetitions).toHaveBeenCalledWith(undefined);
  });

  it("passes the competition search to the repository", async () => {
    const leaderboard = fakeLeaderboard();
    const { service } = setup({ leaderboard });

    await service.leaderboard("group stage");

    expect(leaderboard.listAdminCompetitions).toHaveBeenCalledWith("group stage");
  });
});
