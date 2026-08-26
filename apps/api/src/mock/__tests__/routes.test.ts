import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockCs2SeriesDetail, mockCs2SeriesSummary } from "../fixtures.js";
import { mockRouter } from "../routes.js";

describe("mock CS2 catalog routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
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
    await expect(list.json()).resolves.toEqual({ series: [mockCs2SeriesSummary] });

    const detail = await fetch(`${baseUrl}/series/${mockCs2SeriesSummary.id}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual({ series: mockCs2SeriesDetail });
  });
});
