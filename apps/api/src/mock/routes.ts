// P0.4 mock REST routes — implements the S2 DTO contract (@arena/contracts dto.ts)
// against fixture data. Real implementation lands with B7 (Realtime Gateway + REST API).

import { Router } from "express";
import type { Router as RouterType, Response } from "express";
import type {
  ApiError,
  ArenaDetailResponse,
  BuyEntryRequest,
  BuyEntryResponse,
  LeaderboardResponse,
  MatchListResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";

import {
  MOCK_ENTRY_PASS_ID,
  mockArena,
  mockArenaPlayer,
  mockCurrentRound,
  mockLeaderboard,
  mockMatch,
  mockMatches,
  mockMatchState,
  mockUser,
} from "./fixtures.js";

export const mockRouter: RouterType = Router();

/** Returns true and writes a 404 if `id` isn't the fixture arena's id. */
function arenaNotFound(id: string, res: Response): boolean {
  if (id !== mockArena.id) {
    res.status(404).json({ error: "not_found", message: "Arena not found" } satisfies ApiError);
    return true;
  }
  return false;
}

mockRouter.post<Record<string, never>, WalletSignInResponse, WalletSignInRequest>(
  "/auth/wallet",
  (req, res) => {
    res.json({ token: "mock-token", user: mockUser });
  },
);

mockRouter.get<Record<string, never>, MatchListResponse>("/matches", (_req, res) => {
  res.json({ matches: mockMatches });
});

mockRouter.get<{ id: string }>("/matches/:id", (req, res) => {
  const match = mockMatches.find((m) => m.id === req.params.id);
  if (!match) {
    const error: ApiError = { error: "not_found", message: "Match not found" };
    res.status(404).json(error);
    return;
  }
  res.json(match);
});

mockRouter.get<{ id: string }, ArenaDetailResponse | ApiError>(
  "/arenas/:id",
  (req, res) => {
    if (arenaNotFound(req.params.id, res)) return;
    const body: ArenaDetailResponse = {
      arena: mockArena,
      match: mockMatch,
      matchState: mockMatchState,
      currentRound: mockCurrentRound,
    };
    res.json(body);
  },
);

mockRouter.post<{ id: string }, BuyEntryResponse | ApiError, BuyEntryRequest>(
  "/arenas/:id/entry",
  (req, res) => {
    if (arenaNotFound(req.params.id, res)) return;
    const body: BuyEntryResponse = {
      entryPassId: MOCK_ENTRY_PASS_ID,
      player: mockArenaPlayer,
      arena: mockArena,
    };
    res.json(body);
  },
);

mockRouter.post<{ id: string }, SubmitAnswerResponse | ApiError, SubmitAnswerRequest>(
  "/rounds/:id/answer",
  (req, res) => {
    const { answer } = req.body;
    if (answer !== "yes" && answer !== "no") {
      res.status(400).json({ error: "bad_request", message: "answer must be yes|no" });
      return;
    }
    const body: SubmitAnswerResponse = {
      roundId: req.params.id,
      answer,
      receivedAt: new Date().toISOString(),
    };
    res.json(body);
  },
);

mockRouter.get<{ id: string }, LeaderboardResponse | ApiError>(
  "/arenas/:id/leaderboard",
  (req, res) => {
    if (arenaNotFound(req.params.id, res)) return;
    const body: LeaderboardResponse = { entries: mockLeaderboard };
    res.json(body);
  },
);

// Fallthrough — matches the ApiError shape (spec S2) for anything not implemented above.
mockRouter.use((req, res) => {
  const error: ApiError = {
    error: "not_found",
    message: `No mock route for ${req.method} ${req.path}`,
  };
  res.status(404).json(error);
});
