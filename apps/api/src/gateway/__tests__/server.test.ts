import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { hashEventAccessCode, isEventAccessCodeHash } from "../event-access.js";
import type { GatewayServer } from "../server.js";
import { createGatewayServer } from "../server.js";

describe("production gateway server", () => {
  let server: GatewayServer | undefined;
  let webDistDir: string | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await server.wsGateway.close();
      await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
      server = undefined;
    }
    if (webDistDir !== undefined) {
      await rm(webDistDir, { recursive: true, force: true });
      webDistDir = undefined;
    }
  });

  async function listen(gateway: GatewayServer): Promise<string> {
    server = gateway;
    await new Promise<void>((resolve) => gateway.httpServer.listen(0, resolve));
    return `http://localhost:${(gateway.httpServer.address() as AddressInfo).port}`;
  }

  function waitForClose(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => socket.once("close", (code) => resolve(code)));
  }

  function waitForUpgradeRejection(socket: WebSocket): Promise<number | undefined> {
    return new Promise((resolve) => {
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
    });
  }

  it("reports readiness only while PostgreSQL is reachable", async () => {
    const healthCheck = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db unavailable"));
    const baseUrl = await listen(createGatewayServer({ healthCheck }));

    const healthy = await fetch(`${baseUrl}/healthz`);
    expect(healthy.status).toBe(200);
    await expect(healthy.json()).resolves.toEqual({ status: "ok" });

    const unavailable = await fetch(`${baseUrl}/healthz`);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("exposes only public runtime source metadata", async () => {
    const runtimeConfig = {
      gameSource: "live" as const,
      sourceLabel: "LIVE FEED",
    };
    const baseUrl = await listen(createGatewayServer({ healthCheck: async () => {}, runtimeConfig }));

    const response = await fetch(`${baseUrl}/api/runtime-config`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(runtimeConfig);
  });

  it("exchanges a valid event code for a cookie that protects REST and WebSocket access", async () => {
    const codeHash = await hashEventAccessCode("correct horse battery staple");
    const eventAccess = {
      codeHash,
      sessionSecret: "test-session-secret-with-at-least-32-characters",
      secureCookies: true,
    };
    const baseUrl = await listen(createGatewayServer({ healthCheck: async () => {}, eventAccess }));

    const session = await fetch(`${baseUrl}/api/access/session`);
    await expect(session.json()).resolves.toEqual({ status: "unauthenticated" });

    const protectedResponse = await fetch(`${baseUrl}/api/runtime-config`);
    expect(protectedResponse.status).toBe(401);

    const invalid = await fetch(`${baseUrl}/api/access/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "wrong" }),
    });
    expect(invalid.status).toBe(401);

    const signedIn = await fetch(`${baseUrl}/api/access/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "correct horse battery staple" }),
    });
    expect(signedIn.status).toBe(200);
    const setCookie = signedIn.headers.get("set-cookie");
    expect(setCookie).toContain("Max-Age=604800");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    const cookie = setCookie?.split(";", 1)[0];
    expect(cookie).toMatch(/^sabg_event_access=/);

    const authorized = await fetch(`${baseUrl}/api/runtime-config`, { headers: { cookie: cookie! } });
    expect(authorized.status).toBe(200);

    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const blockedSocket = new WebSocket(wsUrl);
    expect(await waitForUpgradeRejection(blockedSocket)).toBe(401);
    const admittedSocket = new WebSocket(wsUrl, { headers: { cookie: cookie! } });
    expect(await waitForClose(admittedSocket)).toBe(4401);

    const tamperedCookie = `${cookie!.slice(0, -1)}${cookie!.endsWith("A") ? "B" : "A"}`;
    const tampered = await fetch(`${baseUrl}/api/runtime-config`, { headers: { cookie: tamperedCookie } });
    expect(tampered.status).toBe(401);

    const signedOut = await fetch(`${baseUrl}/api/access/session`, { method: "DELETE", headers: { cookie: cookie! } });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects expired access cookies and rate-limits repeated invalid codes", async () => {
    let timestamp = Date.UTC(2026, 6, 18);
    const eventAccess = {
      codeHash: await hashEventAccessCode("event-code"),
      sessionSecret: "test-session-secret-with-at-least-32-characters",
      secureCookies: false,
      now: () => timestamp,
    };
    const baseUrl = await listen(createGatewayServer({ healthCheck: async () => {}, eventAccess }));
    const signedIn = await fetch(`${baseUrl}/api/access/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "event-code" }),
    });
    const cookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0];

    timestamp += 8 * 24 * 60 * 60 * 1_000;
    const expired = await fetch(`${baseUrl}/api/runtime-config`, { headers: { cookie: cookie! } });
    expect(expired.status).toBe(401);

    const attempts = await Promise.all(Array.from({ length: 6 }, () =>
      fetch(`${baseUrl}/api/access/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "wrong" }),
      }),
    ));
    expect(attempts.map((response) => response.status).sort()).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("recognizes only canonical event access hashes", async () => {
    expect(isEventAccessCodeHash(await hashEventAccessCode("event-code"))).toBe(true);
    expect(isEventAccessCodeHash("scrypt$REPLACE_SALT$REPLACE_HASH")).toBe(false);
    expect(isEventAccessCodeHash("scrypt$bad$bad")).toBe(false);
  });

  it("serves the SPA fallback without masking unknown API routes", async () => {
    webDistDir = await mkdtemp(path.join(tmpdir(), "sabg-web-"));
    await writeFile(path.join(webDistDir, "index.html"), "<main>SABG production</main>");
    const baseUrl = await listen(createGatewayServer({
      healthCheck: async () => {},
      webDistDir,
      eventAccess: {
        codeHash: await hashEventAccessCode("event-code"),
        sessionSecret: "test-session-secret-with-at-least-32-characters",
        secureCookies: false,
      },
    }));

    const spa = await fetch(`${baseUrl}/arena/demo`);
    expect(spa.status).toBe(200);
    await expect(spa.text()).resolves.toContain("SABG production");

    const protectedApi = await fetch(`${baseUrl}/api/not-a-route`);
    expect(protectedApi.status).toBe(401);

    const signedIn = await fetch(`${baseUrl}/api/access/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "event-code" }),
    });
    const cookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0];
    const unknownApi = await fetch(`${baseUrl}/api/not-a-route`, { headers: { cookie: cookie! } });
    expect(unknownApi.status).toBe(404);
  });
});
