import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mockCs2LobbyArena,
  mockCs2LobbyMatch,
  mockCs2Series,
  mockCs2SeriesDetail,
  mockCs2SeriesSummary,
} from "../fixtures.js";
import { mockRouter } from "../routes.js";

describe("mock CS2 catalog routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", mockRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("serves the same Series list and detail DTOs as the production router", async () => {
    const list = await fetch(`${baseUrl}/series`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ series: mockCs2Series });

    const detail = await fetch(`${baseUrl}/series/${mockCs2SeriesSummary.id}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual({ series: mockCs2SeriesDetail });
  });

  it("serves the lobby Arena selected from the Series detail", async () => {
    const response = await fetch(`${baseUrl}/arenas/${mockCs2LobbyArena.id}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ arena: mockCs2LobbyArena, match: mockCs2LobbyMatch });
  });

  it("moves the selected mock Arena from entry preparation to live", async () => {
    const prepared = await fetch(`${baseUrl}/arenas/${mockCs2LobbyArena.id}/entry/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress: "11111111111111111111111111111111" }),
    });
    expect(prepared.status).toBe(200);
    const preparation = await prepared.json() as { prepareId: string; tx: string };
    expect(preparation.tx).not.toBe("");

    const submitted = await fetch(`${baseUrl}/arenas/${mockCs2LobbyArena.id}/entry/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prepareId: preparation.prepareId, signedTx: "mock-signed-transaction" }),
    });
    expect(submitted.status).toBe(200);

    const detail = await fetch(`${baseUrl}/arenas/${mockCs2LobbyArena.id}`);
    await expect(detail.json()).resolves.toMatchObject({ arena: { status: "live" } });
  });
});
