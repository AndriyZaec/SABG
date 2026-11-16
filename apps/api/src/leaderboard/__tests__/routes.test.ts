import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerLeaderboardResponse } from "@arena/contracts";
import { issueToken } from "../../gateway/auth.js";
import { createLeaderboardRouter, type PlayerLeaderboardStore } from "../routes.js";

const SCOPE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const computedAt = new Date("2026-10-27T12:00:00.000Z");
const finalizedAt = new Date("2026-02-08T12:00:00.000Z");
const TRADE_URL = "https://steamcommunity.com/tradeoffer/new/?partner=123456&token=AbC-d_9x";
const AWP = "https://cdn.test/skins/awp.png";

const openScope = { id: SCOPE_ID, name: "November", status: "open", isCurrent: true, closedAt: null, finalizedAt: null };
const finalizedScope = { ...openScope, name: "IEM", status: "closed", isCurrent: false, closedAt: finalizedAt, finalizedAt };

const row = (userId: string, rank: number, { avatar = null, disqualified = false }: { avatar?: string | null; disqualified?: boolean } = {}) => ({
  userId, username: `player-${userId}`, avatar, rank, points: 200 - rank, arenasPlayed: 3, wins: 1, secondPlaces: 1,
  roundsPlayed: 30, totalScore: 200 - rank, totalPayoutLamports: 500, disqualified, computedAt,
});

describe("player leaderboard routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let store: { [K in keyof PlayerLeaderboardStore]: ReturnType<typeof vi.fn> };
  const headers = { authorization: `Bearer ${issueToken(USER_ID)}`, "content-type": "application/json" };

  beforeEach(async () => {
    store = {
      findShownScope: vi.fn().mockResolvedValue(openScope),
      listScopeCompetitions: vi.fn().mockResolvedValue([{ name: "BLAST Premier", shortName: "BLAST", logoUrl: null }]),
      listPrizes: vi.fn().mockResolvedValue([]),
      topEntries: vi.fn().mockResolvedValue([row("u1", 1, { avatar: "https://cdn.test/a.png" }), row("u2", 2)]),
      entryFor: vi.fn().mockResolvedValue(undefined),
      findMark: vi.fn().mockResolvedValue(undefined),
      findPrizeClaim: vi.fn().mockResolvedValue(undefined),
      setTradeUrl: vi.fn().mockResolvedValue({ kind: "saved", claim: { place: 1, imageUrl: AWP, tradeUrl: TRADE_URL, sentAt: null } }),
    };
    const app = express();
    app.use(express.json());
    app.use("/api", createLeaderboardRouter(store as unknown as PlayerLeaderboardStore));
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  const me = async () => (await fetch(`${baseUrl}/leaderboard/me`, { headers })).json();
  const sendTradeUrl = (body: unknown) =>
    fetch(`${baseUrl}/leaderboard/prize/trade-url`, { method: "POST", headers, body: JSON.stringify(body) });

  it("returns scope null while no scope is shown", async () => {
    store.findShownScope.mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/leaderboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ scope: null });
    expect(store.topEntries).not.toHaveBeenCalled();
  });

  it("returns the shown scope's tournaments, prizes and top 100 in board order without private columns", async () => {
    const response = await fetch(`${baseUrl}/leaderboard`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      scope: { name: "November", finalized: false },
      competitions: [{ name: "BLAST Premier", shortName: "BLAST" }],
      prizes: [],
      entries: [
        { userId: "u1", username: "player-u1", avatar: "https://cdn.test/a.png", rank: 1, points: 199, wins: 1, arenasPlayed: 3, disqualified: false },
        { userId: "u2", username: "player-u2", rank: 2, points: 198, wins: 1, arenasPlayed: 3, disqualified: false },
      ],
      computedAt: computedAt.toISOString(),
    });
    expect(store.topEntries).toHaveBeenCalledExactlyOnceWith(SCOPE_ID, 100);
  });

  it("gives prize places by position, skipping disqualified rows, and flags a finalized scope", async () => {
    store.findShownScope.mockResolvedValue(finalizedScope);
    store.listPrizes.mockResolvedValue([{ place: 1, imageUrl: AWP }, { place: 2, imageUrl: "https://cdn.test/skins/ak.png" }]);
    // Ranks 1 · 2 (Disqualified) · 2 · 3: the disqualified row takes no place.
    store.topEntries.mockResolvedValue([row("a", 1), row("b", 2, { disqualified: true }), row("c", 2), row("d", 3)]);

    const body = await (await fetch(`${baseUrl}/leaderboard`)).json() as Extract<PlayerLeaderboardResponse, { prizes: unknown }>;

    expect(body.scope).toEqual({ name: "IEM", finalized: true });
    expect(body.prizes).toEqual([{ place: 1, imageUrl: AWP }, { place: 2, imageUrl: "https://cdn.test/skins/ak.png" }]);
    expect(body.entries.map((entry) => [entry.userId, entry.disqualified, entry.prizePlace])).toEqual([
      ["a", false, 1],
      ["b", true, undefined],
      ["c", false, 2],
      ["d", false, undefined],
    ]);
  });

  it("requires sign-in for the player's own row and for the trade URL", async () => {
    expect((await fetch(`${baseUrl}/leaderboard/me`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/leaderboard/prize/trade-url`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tradeUrl: TRADE_URL }),
    });
    expect(response.status).toBe(401);
    expect(store.entryFor).not.toHaveBeenCalled();
    expect(store.setTradeUrl).not.toHaveBeenCalled();
  });

  it("returns the signed-in player's row, or none when unranked or no scope is shown", async () => {
    store.entryFor.mockResolvedValue(row(USER_ID, 140));
    await expect(me()).resolves.toEqual({
      entry: { userId: USER_ID, username: `player-${USER_ID}`, rank: 140, points: 60, wins: 1, arenasPlayed: 3, disqualified: false },
    });
    expect(store.entryFor).toHaveBeenCalledWith(SCOPE_ID, USER_ID);

    store.entryFor.mockResolvedValue(undefined);
    await expect(me()).resolves.toEqual({ entry: null });

    store.findShownScope.mockResolvedValue(undefined);
    store.entryFor.mockClear();
    await expect(me()).resolves.toEqual({ entry: null });
    expect(store.entryFor).not.toHaveBeenCalled();
  });

  it("gives the disqualification reason only to a disqualified player", async () => {
    store.entryFor.mockResolvedValue(row(USER_ID, 2, { disqualified: true }));
    store.findMark.mockResolvedValue({ status: "disqualified", reason: "Several accounts", appliedAt: computedAt });
    await expect(me()).resolves.toMatchObject({ entry: { disqualified: true }, disqualificationReason: "Several accounts" });
    expect(store.findMark).toHaveBeenCalledWith(SCOPE_ID, USER_ID);

    store.findMark.mockResolvedValue({ status: "approved", reason: null, appliedAt: computedAt });
    expect(await me()).not.toHaveProperty("disqualificationReason");
  });

  it("gives the prize only to a winner of the shown finalized scope", async () => {
    store.findPrizeClaim.mockResolvedValue({ place: 1, imageUrl: AWP, tradeUrl: null, sentAt: null });
    expect(await me()).not.toHaveProperty("prize");
    expect(store.findPrizeClaim).not.toHaveBeenCalled();

    store.findShownScope.mockResolvedValue(finalizedScope);
    await expect(me()).resolves.toMatchObject({ prize: { place: 1, imageUrl: AWP, sent: false } });
    expect(store.findPrizeClaim).toHaveBeenCalledWith(SCOPE_ID, USER_ID);

    store.findPrizeClaim.mockResolvedValue({ place: 1, imageUrl: AWP, tradeUrl: TRADE_URL, sentAt: finalizedAt });
    await expect(me()).resolves.toMatchObject({ prize: { place: 1, imageUrl: AWP, tradeUrl: TRADE_URL, sent: true } });

    store.findPrizeClaim.mockResolvedValue(undefined);
    expect(await me()).not.toHaveProperty("prize");
  });

  it("stores a trimmed trade URL on the winner's claim and returns the prize", async () => {
    store.findShownScope.mockResolvedValue(finalizedScope);

    const response = await sendTradeUrl({ tradeUrl: `  ${TRADE_URL}  ` });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ prize: { place: 1, imageUrl: AWP, tradeUrl: TRADE_URL, sent: false } });
    expect(store.setTradeUrl).toHaveBeenCalledExactlyOnceWith(SCOPE_ID, USER_ID, TRADE_URL);
  });

  it("refuses a trade URL that is malformed, without a claim, or after the prize was sent", async () => {
    store.findShownScope.mockResolvedValue(finalizedScope);
    for (const tradeUrl of [
      "http://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
      "https://steamcommunity.com.evil.test/tradeoffer/new/?partner=1&token=abc",
      "https://steamcommunity.com/tradeoffer/new/?partner=abc&token=abc",
      "https://steamcommunity.com/tradeoffer/new/?partner=1",
      "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&x=1",
    ]) {
      expect((await sendTradeUrl({ tradeUrl })).status).toBe(400);
    }
    expect((await sendTradeUrl({})).status).toBe(400);
    expect(store.setTradeUrl).not.toHaveBeenCalled();

    store.setTradeUrl.mockResolvedValue({ kind: "not_found" });
    expect((await sendTradeUrl({ tradeUrl: TRADE_URL })).status).toBe(404);

    store.setTradeUrl.mockResolvedValue({ kind: "sent" });
    const sent = await sendTradeUrl({ tradeUrl: TRADE_URL });
    expect(sent.status).toBe(409);
    await expect(sent.json()).resolves.toMatchObject({ error: "prize_sent" });

    store.setTradeUrl.mockClear();
    store.findShownScope.mockResolvedValue(openScope);
    expect((await sendTradeUrl({ tradeUrl: TRADE_URL })).status).toBe(404);
    expect(store.setTradeUrl).not.toHaveBeenCalled();
  });
});
