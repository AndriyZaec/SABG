import type { Server } from "node:http";
import type { AdminMutationCommand } from "@arena/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApp } from "./app.js";
import type { AdminConfig } from "./config.js";
import type { AdminControlClient, ControlActor } from "./control-client.js";
import type { GitHubOAuthClient } from "./github.js";
import { createOperatorSession, sealSession, SESSION_COOKIE } from "./session.js";

const servers: Server[] = [];

const config: AdminConfig = {
  port: 0,
  publicOrigin: "https://admin.sabg.test",
  githubClientId: "client-id",
  githubClientSecret: "client-secret",
  allowedUserIds: new Set(["1234"]),
  sessionSecret: "a-test-session-secret-that-is-at-least-32-bytes",
  control: { baseUrl: "http://app:4101", machineToken: "machine-token" },
};

const github: GitHubOAuthClient = {
  authorizationUrl: () => "https://github.test/authorize",
  complete: async () => ({ id: "1234", login: "operator" }),
};

async function start(control: AdminControlClient): Promise<string> {
  const server = createAdminApp({ config, github, control }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function mockControl() {
  return {
    status: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    catalog: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    discovery: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    inspect: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    audit: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    mutate: vi.fn<(command: AdminMutationCommand, actor: ControlActor) => ReturnType<AdminControlClient["mutate"]>>()
      .mockResolvedValue({
        status: 409,
        body: { status: "refused", reason: "Another tournament publication is running" },
        requestId: "b87cff24-2c6d-485e-902b-9b9c7396f67c",
      }),
  } satisfies AdminControlClient;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("admin control proxy", () => {
  it("requires authentication before calling the control service", async () => {
    const control = mockControl();
    const origin = await start(control);

    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
    expect((await fetch(`${origin}/api/control/status`)).status).toBe(401);
    expect(control.status).not.toHaveBeenCalled();
    const missing = await fetch(`${origin}/api/control/not-a-route`, { headers: { accept: "text/html" } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    await expect(missing.json()).resolves.toEqual({ error: "not_found", message: "API route not found" });
  });

  it("uses session identity and requires Origin and CSRF for mutations", async () => {
    const control = mockControl();
    const origin = await start(control);
    const session = createOperatorSession("1234", "operator");
    const cookie = `${SESSION_COOKIE}=${sealSession(session, config.sessionSecret)}`;
    const command = { type: "autopilot.set", enabled: false } as const;

    const rejected = await fetch(`${origin}/api/control/mutations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "https://attacker.test", "x-csrf-token": session.csrfToken },
      body: JSON.stringify(command),
    });
    expect(rejected.status).toBe(403);
    expect(control.mutate).not.toHaveBeenCalled();

    const accepted = await fetch(`${origin}/api/control/mutations`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: config.publicOrigin,
        "x-csrf-token": session.csrfToken,
        "x-operator-id": "forged-id",
        "x-operator-login": "forged-login",
      },
      body: JSON.stringify(command),
    });
    expect(accepted.status).toBe(409);
    expect(accepted.headers.get("x-request-id")).toBe("b87cff24-2c6d-485e-902b-9b9c7396f67c");
    expect(control.mutate).toHaveBeenCalledWith(command, { id: "1234", login: "operator" });
    expect(await accepted.json()).toEqual({ status: "refused", reason: "Another tournament publication is running" });
  });
});
