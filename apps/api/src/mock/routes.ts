// Mock REST routes — implements the DTO contract (@arena/contracts dto.ts)
// against fixture data. Real implementation lands with the Realtime Gateway + REST API.

import { Router } from "express";
import type { Router as RouterType, Response } from "express";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type {
  ApiError,
  ArenaDetailResponse,
  BuyEntryRequest,
  BuyEntryResponse,
  LeaderboardResponse,
  MatchListResponse,
  PrepareEntryRequest,
  PrepareEntryResponse,
  SubmitEntryRequest,
  SubmitEntryResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { createCs2CatalogRouter, type Cs2CatalogReadStore } from "../cs2/catalog-routes.js";

import {
  MOCK_ENTRY_PASS_ID,
  mockArena,
  mockArenaPlayer,
  mockCurrentRound,
  mockCs2LobbyArena,
  mockCs2LobbyMatch,
  mockCs2Series,
  mockCs2SeriesDetails,
  mockLeaderboard,
  mockMatch,
  mockMatches,
  mockMatchState,
  mockUser,
} from "./fixtures.js";

export const mockRouter: RouterType = Router();

const mockCs2CatalogStore: Cs2CatalogReadStore = {
  async listSupported() {
    return mockCs2Series;
  },
  async findSupportedDetailById(id) {
    const series = mockCs2SeriesDetails.find((candidate) => candidate.id === id);
    if (!series || !mockCs2LobbyLive) return series;
    return {
      ...series,
      maps: series.maps.map((map) =>
        map.state !== "pending" && map.arena.id === mockCs2LobbyArena.id ? { ...map, state: "live" as const } : map,
      ),
    };
  },
};

let mockCs2LobbyLive = false;

export function isMockArenaReadyForTimeline(arenaId: string): boolean {
  return arenaId !== mockCs2LobbyArena.id || mockCs2LobbyLive;
}

function currentMockCs2LobbyArena() {
  return mockCs2LobbyLive ? { ...mockCs2LobbyArena, status: "live" as const } : mockCs2LobbyArena;
}

mockRouter.use(createCs2CatalogRouter(mockCs2CatalogStore));

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
    if (req.params.id === mockArena.id) {
      res.json({
        arena: mockArena,
        match: mockMatch,
        matchState: mockMatchState,
        currentRound: mockCurrentRound,
      } satisfies ArenaDetailResponse);
      return;
    }
    if (req.params.id === mockCs2LobbyArena.id) {
      res.json({ arena: currentMockCs2LobbyArena(), match: mockCs2LobbyMatch } satisfies ArenaDetailResponse);
      return;
    }
    res.status(404).json({ error: "not_found", message: "Arena not found" } satisfies ApiError);
  },
);

mockRouter.post<{ id: string }, PrepareEntryResponse | ApiError, PrepareEntryRequest>(
  "/arenas/:id/entry/prepare",
  (req, res) => {
    if (req.params.id !== mockCs2LobbyArena.id) {
      res.status(404).json({ error: "not_found", message: "Arena not found" });
      return;
    }
    if (mockCs2LobbyLive) {
      res.status(409).json({ error: "arena_not_joinable", message: "Arena has already started" });
      return;
    }
    try {
      const wallet = new PublicKey(req.body.walletAddress);
      const transaction = new Transaction({
        feePayer: wallet,
        recentBlockhash: SystemProgram.programId.toBase58(),
      }).add(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wallet, lamports: 0 }));
      res.json({
        prepareId: MOCK_ENTRY_PASS_ID,
        tx: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      });
    } catch {
      res.status(400).json({ error: "bad_request", message: "walletAddress is invalid" });
    }
  },
);

mockRouter.post<{ id: string }, SubmitEntryResponse | ApiError, SubmitEntryRequest>(
  "/arenas/:id/entry/submit",
  (req, res) => {
    if (req.params.id !== mockCs2LobbyArena.id) {
      res.status(404).json({ error: "not_found", message: "Arena not found" });
      return;
    }
    if (mockCs2LobbyLive) {
      res.status(409).json({ error: "arena_not_joinable", message: "Arena has already started" });
      return;
    }
    if (req.body.prepareId !== MOCK_ENTRY_PASS_ID || !req.body.signedTx) {
      res.status(400).json({ error: "bad_request", message: "Invalid prepared entry" });
      return;
    }
    mockCs2LobbyLive = true;
    res.json({
      token: "mock-token",
      entryPassId: MOCK_ENTRY_PASS_ID,
      player: { ...mockArenaPlayer, arenaId: mockCs2LobbyArena.id },
      arena: currentMockCs2LobbyArena(),
    });
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

// Fallthrough — matches the ApiError shape for anything not implemented above.
mockRouter.use((req, res) => {
  const error: ApiError = {
    error: "not_found",
    message: `No mock route for ${req.method} ${req.path}`,
  };
  res.status(404).json(error);
});
