import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken } from "../../gateway/auth.js";
import { createLeaderboardRouter, type PlayerLeaderboardStore } from "../routes.js";

const SCOPE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const computedAt = new Date("2026-10-27T12:00:00.000Z");

const row = (userId: string, rank: number, avatar: string | null = null) => ({
  userId, username: `player-${rank}`, avatar, rank, points: 200 - rank, arenasPlayed: 3, wins: 1, secondPlaces: 1,
  roundsPlayed: 30, totalScore: 200 - rank, totalPayoutLamports: 500, computedAt,
});

describe("player leaderboard routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let store: { [K in keyof PlayerLeaderboardStore]: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    store = {
      findCurrent: vi.fn().mockResolvedValue({ id: SCOPE_ID, name: "November", status: "open", isCurrent: true, closedAt: null }),
      listScopeCompetitions: vi.fn().mockResolvedValue([{ name: "BLAST Premier", shortName: "BLAST", logoUrl: null }]),
      topEntries: vi.fn().mockResolvedValue([row("u1", 1, "https://cdn.test/a.png"), row("u2", 2)]),
      entryFor: vi.fn().mockResolvedValue(undefined),
    };
    const app = express();
    app.use("/api", createLeaderboardRouter(store as unknown as PlayerLeaderboardStore));
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("returns scope null while no scope is current", async () => {
    store.findCurrent.mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/leaderboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ scope: null });
    expect(store.topEntries).not.toHaveBeenCalled();
  });

  it("returns the current scope's counted tournaments and top 100 in rank order without private columns", async () => {
    const response = await fetch(`${baseUrl}/leaderboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      scope: { name: "November" },
      competitions: [{ name: "BLAST Premier", shortName: "BLAST" }],
      entries: [
        { userId: "u1", username: "player-1", avatar: "https://cdn.test/a.png", rank: 1, points: 199, wins: 1, arenasPlayed: 3 },
        { userId: "u2", username: "player-2", rank: 2, points: 198, wins: 1, arenasPlayed: 3 },
      ],
      computedAt: computedAt.toISOString(),
    });
    expect(store.topEntries).toHaveBeenCalledExactlyOnceWith(SCOPE_ID, 100);
  });

  it("requires sign-in for the player's own row", async () => {
    const response = await fetch(`${baseUrl}/leaderboard/me`);

    expect(response.status).toBe(401);
    expect(store.entryFor).not.toHaveBeenCalled();
  });

  it("returns the signed-in player's row, or none when unranked or no scope is current", async () => {
    const headers = { authorization: `Bearer ${issueToken(USER_ID)}` };

    store.entryFor.mockResolvedValue(row(USER_ID, 140));
    await expect((await fetch(`${baseUrl}/leaderboard/me`, { headers })).json()).resolves.toEqual({
      entry: { userId: USER_ID, username: "player-140", rank: 140, points: 60, wins: 1, arenasPlayed: 3 },
    });
    expect(store.entryFor).toHaveBeenCalledWith(SCOPE_ID, USER_ID);

    store.entryFor.mockResolvedValue(undefined);
    await expect((await fetch(`${baseUrl}/leaderboard/me`, { headers })).json()).resolves.toEqual({ entry: null });

    store.findCurrent.mockResolvedValue(undefined);
    store.entryFor.mockClear();
    await expect((await fetch(`${baseUrl}/leaderboard/me`, { headers })).json()).resolves.toEqual({ entry: null });
    expect(store.entryFor).not.toHaveBeenCalled();
  });
});
