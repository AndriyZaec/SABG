import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cs2SeriesDetail, Cs2SeriesSummary } from "@arena/contracts";
import { createCs2CatalogRouter, type Cs2CatalogReadStore } from "../catalog-routes.js";

const SERIES_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";

const summary: Cs2SeriesSummary = {
  id: SERIES_ID,
  participants: [
    {
      state: "known",
      displayOrder: 1,
      team: { id: TEAM_ID, name: "Team A" },
      seriesScore: 0,
    },
    { state: "tbd", displayOrder: 2, seriesScore: null },
  ],
  competition: { name: "BLAST" },
  format: 3,
  scheduledStartTime: "2026-09-01T12:00:00.000Z",
  lifecycle: "upcoming",
};

const detail: Cs2SeriesDetail = {
  ...summary,
  maps: [
    { state: "pending", seriesMatchIndex: 1 },
    { state: "pending", seriesMatchIndex: 2 },
    { state: "pending", seriesMatchIndex: 3 },
  ],
};

describe("CS2 catalog routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let listSupported: ReturnType<typeof vi.fn>;
  let findSupportedDetailById: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listSupported = vi.fn().mockResolvedValue([summary]);
    findSupportedDetailById = vi.fn().mockResolvedValue(detail);
    const store = { listSupported, findSupportedDetailById } as Cs2CatalogReadStore;
    const app = express();
    app.use("/api", createCs2CatalogRouter(store));
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("returns the supported Series catalog", async () => {
    const response = await fetch(`${baseUrl}/series`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ series: [summary] });
  });

  it("returns an allowlisted Series detail by internal UUID", async () => {
    const response = await fetch(`${baseUrl}/series/${SERIES_ID}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ series: detail });
    expect(findSupportedDetailById).toHaveBeenCalledWith(SERIES_ID);
  });

  it("rejects malformed UUIDs before repository access", async () => {
    const response = await fetch(`${baseUrl}/series/not-a-uuid`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_request", message: "seriesId must be a UUID" });
    expect(findSupportedDetailById).not.toHaveBeenCalled();
  });

  it("hides unknown, unsupported, and non-allowlisted Series behind 404", async () => {
    findSupportedDetailById.mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/series/${SERIES_ID}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found", message: "Series not found" });
  });
});
