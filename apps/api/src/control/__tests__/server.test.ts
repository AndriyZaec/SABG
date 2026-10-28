import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorControlDependencies } from "../service.js";
import { OperatorControlService } from "../service.js";
import { createOperatorControlServer } from "../server.js";

const TOKEN = "test-machine-token-with-at-least-32-characters";

function fakeLeaderboard(): OperatorControlDependencies["leaderboard"] {
  return {
    listScopes: vi.fn().mockResolvedValue([]),
    findScope: vi.fn(),
    findCurrent: vi.fn(),
    createScope: vi.fn(),
    renameScope: vi.fn(),
    setCurrent: vi.fn(),
    closeCurrent: vi.fn(),
    addCompetition: vi.fn(),
    removeCompetition: vi.fn(),
    competitionExists: vi.fn(),
    listAdminCompetitions: vi.fn().mockResolvedValue([]),
    topEntries: vi.fn().mockResolvedValue([]),
    recomputeScope: vi.fn(),
  };
}

describe("operator control machine authentication", () => {
  let server: ReturnType<typeof createOperatorControlServer> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
  });

  it("rejects requests without the valid machine token", async () => {
    const status = vi.fn().mockResolvedValue({ runningSeriesIds: [], unfinishedArenaCount: 0 });
    const deps = {
      getActiveTournamentId: vi.fn().mockResolvedValue(undefined),
      setActiveTournamentId: vi.fn(),
      isAutopilotEnabled: vi.fn().mockResolvedValue(true),
      setAutopilotEnabled: vi.fn(),
      readRuntimeState: status,
      hasRunner: vi.fn().mockReturnValue(false),
      runWhileIdle: async (task) => ({ kind: "completed", value: await task() }),
      listCatalog: vi.fn(),
      getRunningSeriesId: vi.fn(),
      findSeries: vi.fn(),
      setSeriesPriority: vi.fn(),
      setSeriesStream: vi.fn(),
      requestSeriesSkip: vi.fn(),
      hasPaidEntry: vi.fn(),
      acquirePublishLock: vi.fn(),
      appendAudit: vi.fn(),
      listAudits: vi.fn(),
      discover: vi.fn(),
      inspect: vi.fn(),
      activate: vi.fn(),
      leaderboard: fakeLeaderboard(),
    } satisfies OperatorControlDependencies;
    server = createOperatorControlServer({
      machineToken: "test-machine-token-with-at-least-32-characters",
      service: new OperatorControlService(deps, "test-revision"),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

    const missing = await fetch(`${baseUrl}/status`);
    const wrong = await fetch(`${baseUrl}/status`, { headers: { authorization: "Bearer wrong" } });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(status).not.toHaveBeenCalled();

    const valid = await fetch(`${baseUrl}/status`, {
      headers: { authorization: "Bearer test-machine-token-with-at-least-32-characters" },
    });
    expect(valid.status).toBe(200);
    expect(status).toHaveBeenCalledOnce();
  });
});

describe("operator control leaderboard routes", () => {
  let server: ReturnType<typeof createOperatorControlServer> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
  });

  async function start(service: Partial<OperatorControlService>): Promise<string> {
    server = createOperatorControlServer({ machineToken: TOKEN, service: service as OperatorControlService });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  const headers = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "x-operator-id": "123",
    "x-operator-login": "operator",
  };

  it("serves the admin leaderboard", async () => {
    const body = {
      scopes: [],
      competitions: [{ id: "c1", name: "Cup", scopeIds: [], arenasWithResults: 0, unfinished: true }],
    };
    const baseUrl = await start({ leaderboard: vi.fn().mockResolvedValue(body) });
    const response = await fetch(`${baseUrl}/leaderboard`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it("validates leaderboard mutations before running them", async () => {
    const mutate = vi.fn().mockResolvedValue({ result: { status: "succeeded" } });
    const baseUrl = await start({ mutate });
    const post = (command: unknown) => fetch(`${baseUrl}/mutations`, { method: "POST", headers, body: JSON.stringify(command) });

    expect((await post({ type: "leaderboard.scope.create", name: "   " })).status).toBe(400);
    expect((await post({ type: "leaderboard.scope.current.set", scopeId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ type: "leaderboard.competition.add", scopeId: "3f0c5b9e-8f3a-4d7e-9a51-2b6f0c1d4e7a" })).status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();

    expect((await post({ type: "leaderboard.scope.create", name: "  Autumn  " })).status).toBe(200);
    expect(mutate).toHaveBeenCalledWith({ type: "leaderboard.scope.create", name: "Autumn" }, { id: "123", login: "operator" }, expect.any(String));
  });
});
