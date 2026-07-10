// B7 REST handler tests — DB-free: the repository modules are mocked (vi.mock) so this exercises
// routing, status codes, auth gating, and the mock's documented quirks (bare Match from
// /matches/:id, uniform ApiError, 404 fallthrough) without touching Postgres. The DB layer itself
// is covered separately by db/__tests__/repositories.int.test.ts (DATABASE_URL-gated).

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arena, ArenaPlayer, EntryPass, Match, Prediction, PredictionRound, User } from "@arena/contracts";

vi.mock("../../db/repositories/user.repository.js", () => ({
  userRepository: { upsertByWallet: vi.fn(), findById: vi.fn() },
}));
vi.mock("../../db/repositories/match.repository.js", () => ({
  matchRepository: { list: vi.fn(), findById: vi.fn() },
}));
vi.mock("../../db/repositories/arena.repository.js", () => ({
  arenaRepository: { findById: vi.fn(), bumpActivePlayers: vi.fn(), listByMatchId: vi.fn() },
}));
vi.mock("../../db/repositories/arena-player.repository.js", () => ({
  arenaPlayerRepository: { join: vi.fn() },
}));
vi.mock("../../db/repositories/prediction-round.repository.js", () => ({
  predictionRoundRepository: { findById: vi.fn(), listByArenaId: vi.fn() },
}));
vi.mock("../../db/repositories/prediction.repository.js", () => ({
  predictionRepository: { listByRoundId: vi.fn() },
}));
vi.mock("../../db/repositories/entry-pass.repository.js", () => ({
  entryPassRepository: { create: vi.fn() },
}));

const { userRepository } = await import("../../db/repositories/user.repository.js");
const { matchRepository } = await import("../../db/repositories/match.repository.js");
const { arenaRepository } = await import("../../db/repositories/arena.repository.js");
const { arenaPlayerRepository } = await import("../../db/repositories/arena-player.repository.js");
const { predictionRoundRepository } = await import("../../db/repositories/prediction-round.repository.js");
const { predictionRepository } = await import("../../db/repositories/prediction.repository.js");
const { entryPassRepository } = await import("../../db/repositories/entry-pass.repository.js");
const { createRestRouter } = await import("../rest.js");
const { issueToken } = await import("../auth.js");

const ARENA_ID = "arena-1";
const MATCH_ID = "match-1";

function fakeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: MATCH_ID,
    homeTeam: "A",
    awayTeam: "B",
    startTime: "2024-01-01T00:00:00.000Z",
    status: "live",
    currentMinute: 10,
    period: "first_half",
    score: { home: 0, away: 0 },
    ...overrides,
  };
}

function fakeArena(overrides: Partial<Arena> = {}): Arena {
  return {
    id: ARENA_ID,
    matchId: MATCH_ID,
    status: "lobby",
    activePlayersCount: 0,
    entryFeeLamports: 1000,
    prizePoolLamports: 0,
    escrowAccount: "Escrow1",
    ...overrides,
  };
}

function fakeRound(overrides: Partial<PredictionRound> = {}): PredictionRound {
  return {
    id: "round-1",
    arenaId: ARENA_ID,
    matchId: MATCH_ID,
    windowStartMinute: 0,
    windowEndMinute: 5,
    question: "Will there be a shot?",
    targetEventType: "shot",
    targetTeam: "any",
    settlementCondition: {
      targetEventType: "shot",
      targetTeam: "any",
      windowStartMinute: 0,
      windowEndMinute: 5,
      resolve: "event_in_window",
    },
    status: "open",
    ...overrides,
  };
}

describe("REST gateway routes", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let runtimeLookup: { getRuntime: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    runtimeLookup = { getRuntime: vi.fn().mockReturnValue(undefined) };

    const app = express();
    app.use(express.json());
    app.use("/api", createRestRouter(runtimeLookup as never));

    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  describe("POST /auth/wallet", () => {
    it("upserts a user by wallet address and returns a session token", async () => {
      const user: User = { id: "u1", walletAddress: "wallet1", username: "fan_wallet" };
      vi.mocked(userRepository.upsertByWallet).mockResolvedValue(user);

      const res = await fetch(`${baseUrl}/auth/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: "wallet1", signature: "sig", message: "msg" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string; user: User };
      expect(body.user).toEqual(user);
      expect(typeof body.token).toBe("string");
    });

    it("400s when walletAddress is missing", async () => {
      const res = await fetch(`${baseUrl}/auth/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /matches and /matches/:id", () => {
    it("returns {matches} for the list route", async () => {
      const matches = [fakeMatch()];
      vi.mocked(matchRepository.list).mockResolvedValue(matches);

      const res = await fetch(`${baseUrl}/matches`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ matches });
    });

    it("returns a bare Match (not {match}) for /matches/:id", async () => {
      const match = fakeMatch();
      vi.mocked(matchRepository.findById).mockResolvedValue(match);

      const res = await fetch(`${baseUrl}/matches/${MATCH_ID}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(match);
    });

    it("404s with an ApiError for an unknown match id", async () => {
      vi.mocked(matchRepository.findById).mockResolvedValue(undefined);

      const res = await fetch(`${baseUrl}/matches/unknown`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("not_found");
    });
  });

  describe("GET /arenas?matchId=", () => {
    it("400s when matchId is missing", async () => {
      const res = await fetch(`${baseUrl}/arenas`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("bad_request");
    });

    it("returns the arena(s) running against the given matchId", async () => {
      const arena = fakeArena();
      vi.mocked(arenaRepository.listByMatchId).mockResolvedValue([arena]);

      const res = await fetch(`${baseUrl}/arenas?matchId=${MATCH_ID}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ arenas: [arena] });
      expect(arenaRepository.listByMatchId).toHaveBeenCalledWith(MATCH_ID);
    });

    it("returns an empty list when no arena exists for that match", async () => {
      vi.mocked(arenaRepository.listByMatchId).mockResolvedValue([]);

      const res = await fetch(`${baseUrl}/arenas?matchId=${MATCH_ID}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ arenas: [] });
    });
  });

  describe("GET /arenas/:id", () => {
    it("404s when the arena doesn't exist", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}`);
      expect(res.status).toBe(404);
    });

    it("omits matchState/currentRound when no runtime is registered for the arena", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      vi.mocked(matchRepository.findById).mockResolvedValue(fakeMatch());
      runtimeLookup.getRuntime.mockReturnValue(undefined);

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}`);
      const body = await res.json();
      expect(body).not.toHaveProperty("matchState");
      expect(body).not.toHaveProperty("currentRound");
    });

    it("includes matchState/currentRound when a runtime is registered", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      const match = fakeMatch();
      vi.mocked(matchRepository.findById).mockResolvedValue(match);
      const matchState = {
        matchId: MATCH_ID,
        period: "first_half" as const,
        currentMinute: 10,
        score: { home: 0, away: 0 },
        shots: { home: 0, away: 0 },
        corners: { home: 0, away: 0 },
        cards: { home: 0, away: 0 },
      };
      runtimeLookup.getRuntime.mockReturnValue({ matchState, currentRound: undefined });

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}`);
      const body = (await res.json()) as { matchState: unknown };
      expect(body.matchState).toEqual(matchState);
    });
  });

  describe("POST /arenas/:id/entry", () => {
    it("401s without an auth token", async () => {
      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txSignature: "sig" }),
      });
      expect(res.status).toBe(401);
    });

    it("409s when the arena has already started (not in lobby)", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena({ status: "live" }));
      const token = issueToken("u1");

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/entry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ txSignature: "sig" }),
      });
      expect(res.status).toBe(409);
    });

    it("joins the arena and calls the runtime's join on success", async () => {
      const arena = fakeArena();
      vi.mocked(arenaRepository.findById).mockResolvedValue(arena);
      const user: User = { id: "u1", walletAddress: "wallet1", username: "fan_wallet" };
      vi.mocked(userRepository.findById).mockResolvedValue(user);
      const entryPass: EntryPass = {
        id: "entry-1",
        arenaId: ARENA_ID,
        userId: "u1",
        walletAddress: "wallet1",
        amountLamports: 1000,
        txSignature: "sig",
        status: "paid",
        purchasedAt: "2024-01-01T00:00:00.000Z",
      };
      vi.mocked(entryPassRepository.create).mockResolvedValue(entryPass);
      const player: ArenaPlayer = {
        id: "player-1",
        arenaId: ARENA_ID,
        userId: "u1",
        status: "active",
        score: 0,
        joinedAt: "2024-01-01T00:00:00.000Z",
      };
      vi.mocked(arenaPlayerRepository.join).mockResolvedValue(player);
      const runtimeJoin = vi.fn();
      runtimeLookup.getRuntime.mockReturnValue({ join: runtimeJoin });

      const token = issueToken("u1");
      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/entry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ txSignature: "sig" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entryPassId: string; player: ArenaPlayer };
      expect(body.entryPassId).toBe("entry-1");
      expect(body.player).toEqual(player);
      expect(arenaRepository.bumpActivePlayers).toHaveBeenCalledWith(ARENA_ID, 1);
      expect(runtimeJoin).toHaveBeenCalledWith("u1", "fan_wallet", player.joinedAt);
    });
  });

  describe("POST /rounds/:id/answer", () => {
    it("401s without an auth token", async () => {
      const res = await fetch(`${baseUrl}/rounds/r1/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "yes" }),
      });
      expect(res.status).toBe(401);
    });

    it("400s for an invalid answer value", async () => {
      const token = issueToken("u1");
      const res = await fetch(`${baseUrl}/rounds/r1/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ answer: "maybe" }),
      });
      expect(res.status).toBe(400);
    });

    it("404s when the round doesn't exist", async () => {
      vi.mocked(predictionRoundRepository.findById).mockResolvedValue(undefined);
      const token = issueToken("u1");
      const res = await fetch(`${baseUrl}/rounds/r1/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ answer: "yes" }),
      });
      expect(res.status).toBe(404);
    });

    it("409s when the runtime reports the round is locked", async () => {
      const round = { arenaId: ARENA_ID, id: "r1" } as PredictionRound;
      vi.mocked(predictionRoundRepository.findById).mockResolvedValue(round);
      const submitAnswer = vi.fn().mockReturnValue({ ok: false, reason: "round_locked" });
      runtimeLookup.getRuntime.mockReturnValue({ submitAnswer });

      const token = issueToken("u1");
      const res = await fetch(`${baseUrl}/rounds/r1/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ answer: "yes" }),
      });
      expect(res.status).toBe(409);
    });

    it("200s with the receivedAt echoed back on success", async () => {
      const round = { arenaId: ARENA_ID, id: "r1" } as PredictionRound;
      vi.mocked(predictionRoundRepository.findById).mockResolvedValue(round);
      const submitAnswer = vi.fn().mockReturnValue({ ok: true, receivedAt: "2024-01-01T00:00:05.000Z" });
      runtimeLookup.getRuntime.mockReturnValue({ submitAnswer });

      const token = issueToken("u1");
      const res = await fetch(`${baseUrl}/rounds/r1/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ answer: "yes" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ roundId: "r1", answer: "yes", receivedAt: "2024-01-01T00:00:05.000Z" });
      expect(submitAnswer).toHaveBeenCalledWith("u1", "r1", "yes");
    });
  });

  describe("GET /arenas/:id/leaderboard", () => {
    it("404s when the arena doesn't exist", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/leaderboard`);
      expect(res.status).toBe(404);
    });

    it("returns entries and omits winners when the arena hasn't finished", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      const entries = [{ userId: "u1", username: "u", status: "active" as const, score: 1, missedCount: 0, joinedAt: "t" }];
      runtimeLookup.getRuntime.mockReturnValue({
        leaderboardSnapshot: () => entries,
        finalWinners: () => undefined,
      });

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/leaderboard`);
      const body = await res.json();
      expect(body).toEqual({ entries });
    });

    it("includes winners once the arena has finished", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      runtimeLookup.getRuntime.mockReturnValue({
        leaderboardSnapshot: () => [],
        finalWinners: () => ["u1"],
      });

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/leaderboard`);
      const body = (await res.json()) as { winners?: string[] };
      expect(body.winners).toEqual(["u1"]);
    });
  });

  describe("GET /arenas/:id/rounds", () => {
    it("404s when the arena doesn't exist", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/rounds`);
      expect(res.status).toBe(404);
    });

    it("includes predictions for a settled round", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      const settledRound = fakeRound({ status: "settled", correctAnswer: "yes" });
      vi.mocked(predictionRoundRepository.listByArenaId).mockResolvedValue([settledRound]);
      const prediction: Prediction = {
        id: "p1",
        roundId: settledRound.id,
        userId: "u1",
        answer: "yes",
        answeredAt: "2024-01-01T00:00:00.000Z",
        receivedAt: "2024-01-01T00:00:00.000Z",
        result: "correct",
      };
      vi.mocked(predictionRepository.listByRoundId).mockResolvedValue([prediction]);

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/rounds`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rounds: { round: PredictionRound; predictions: Prediction[] }[] };
      expect(body.rounds).toEqual([{ round: settledRound, predictions: [prediction] }]);
      expect(predictionRepository.listByRoundId).toHaveBeenCalledWith(settledRound.id);
    });

    it("omits predictions (empty array) for an open or locked round — never revealed before settle", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      const openRound = fakeRound({ id: "round-open", status: "open" });
      const lockedRound = fakeRound({ id: "round-locked", status: "locked" });
      vi.mocked(predictionRoundRepository.listByArenaId).mockResolvedValue([openRound, lockedRound]);

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/rounds`);
      const body = (await res.json()) as { rounds: { round: PredictionRound; predictions: Prediction[] }[] };
      expect(body.rounds).toEqual([
        { round: openRound, predictions: [] },
        { round: lockedRound, predictions: [] },
      ]);
      // Never even queried for predictions on a not-yet-settled round.
      expect(predictionRepository.listByRoundId).not.toHaveBeenCalled();
    });

    it("returns an empty rounds list when the arena has no rounds yet", async () => {
      vi.mocked(arenaRepository.findById).mockResolvedValue(fakeArena());
      vi.mocked(predictionRoundRepository.listByArenaId).mockResolvedValue([]);

      const res = await fetch(`${baseUrl}/arenas/${ARENA_ID}/rounds`);
      expect(await res.json()).toEqual({ rounds: [] });
    });
  });

  it("404s with an ApiError for an unmatched route", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
