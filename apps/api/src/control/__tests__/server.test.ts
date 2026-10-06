import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorControlDependencies } from "../service.js";
import { OperatorControlService } from "../service.js";
import { createOperatorControlServer } from "../server.js";

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
