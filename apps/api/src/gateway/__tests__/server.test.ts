import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      deploymentEnvironment: "demo" as const,
      gameSource: "live" as const,
      sourceLabel: "DEMO - LIVE FEED",
    };
    const baseUrl = await listen(createGatewayServer({ healthCheck: async () => {}, runtimeConfig }));

    const response = await fetch(`${baseUrl}/api/runtime-config`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(runtimeConfig);
  });

  it("serves the SPA fallback without masking unknown API routes", async () => {
    webDistDir = await mkdtemp(path.join(tmpdir(), "sabg-web-"));
    await writeFile(path.join(webDistDir, "index.html"), "<main>SABG production</main>");
    const baseUrl = await listen(createGatewayServer({ healthCheck: async () => {}, webDistDir }));

    const spa = await fetch(`${baseUrl}/arena/demo`);
    expect(spa.status).toBe(200);
    await expect(spa.text()).resolves.toContain("SABG production");

    const api = await fetch(`${baseUrl}/api/not-a-route`);
    expect(api.status).toBe(404);
  });
});
