// B7 — real REST handlers, replacing the P0.4 mock (apps/api/src/mock/routes.ts) against
// Postgres + the arena runtime registry instead of fixtures. Deliberately preserves the mock's
// documented quirks: GET /matches/:id returns a bare `Match` (not `{match}`), uniform `ApiError`
// shape, and a 404 fallthrough for unmatched routes.

import { Router } from "express";
import type { Router as RouterType, Response } from "express";
import type {
  ApiError,
  ArenaDetailResponse,
  ArenaListResponse,
  ArenaRoundsResponse,
  BuyEntryRequest,
  BuyEntryResponse,
  LeaderboardResponse,
  MatchListResponse,
  RoundWithPredictions,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { userRepository } from "../db/repositories/user.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { arenaPlayerRepository } from "../db/repositories/arena-player.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { predictionRepository } from "../db/repositories/prediction.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { issueToken, requireAuth, type AuthedRequest } from "./auth.js";
import type { ArenaRuntimeLookup } from "./arena-runtime.js";

function notFound(res: Response, message: string): void {
  res.status(404).json({ error: "not_found", message } satisfies ApiError);
}

export function createRestRouter(runtimeLookup: ArenaRuntimeLookup): RouterType {
  const router = Router();

  /**
   * POST /auth/wallet — minimal session-token auth (scope decision, see auth.ts's doc comment):
   * upserts a User by the reported wallet address and issues a session token. C5 seam: real
   * `tweetnacl` signature verification over a server-issued nonce slots in right here, before the
   * upsert; this handler trusts the reported walletAddress until that lands.
   */
  router.post<Record<string, never>, WalletSignInResponse | ApiError, WalletSignInRequest>(
    "/auth/wallet",
    async (req, res) => {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        res.status(400).json({ error: "bad_request", message: "walletAddress is required" });
        return;
      }
      const username = `fan_${walletAddress.slice(0, 6)}`;
      const user = await userRepository.upsertByWallet(walletAddress, username);
      const token = issueToken(user.id);
      res.json({ token, user });
    },
  );

  router.get<Record<string, never>, MatchListResponse>("/matches", async (_req, res) => {
    const matches = await matchRepository.list();
    res.json({ matches });
  });

  // Bare Match, not {match} — matches the mock's asymmetry with GET /matches above.
  router.get<{ id: string }>("/matches/:id", async (req, res) => {
    const match = await matchRepository.findById(req.params.id);
    if (!match) {
      notFound(res, "Match not found");
      return;
    }
    res.json(match);
  });

  /** GET /arenas?matchId= — lobby discovery (F2): find the arena(s) running against a match. */
  router.get<Record<string, never>, ArenaListResponse | ApiError>("/arenas", async (req, res) => {
    const matchId = req.query["matchId"];
    if (typeof matchId !== "string" || matchId.length === 0) {
      res.status(400).json({ error: "bad_request", message: "matchId query param is required" });
      return;
    }
    const arenas = await arenaRepository.listByMatchId(matchId);
    res.json({ arenas });
  });

  router.get<{ id: string }, ArenaDetailResponse | ApiError>("/arenas/:id", async (req, res) => {
    const arena = await arenaRepository.findById(req.params.id);
    if (!arena) {
      notFound(res, "Arena not found");
      return;
    }
    const match = await matchRepository.findById(arena.matchId);
    if (!match) {
      notFound(res, "Match not found");
      return;
    }
    const runtime = runtimeLookup.getRuntime(arena.id);
    const body: ArenaDetailResponse = {
      arena,
      match,
      ...(runtime !== undefined ? { matchState: runtime.matchState } : {}),
      ...(runtime?.currentRound !== undefined ? { currentRound: runtime.currentRound } : {}),
    };
    res.json(body);
  });

  /**
   * POST /arenas/:id/entry — confirm an on-chain entry purchase (records the reported
   * txSignature without on-chain verification — C1/C2 are out of B7's scope, see the plan's
   * non-goals) and joins the arena (spec §9: pre-kickoff only).
   */
  router.post<{ id: string }, BuyEntryResponse | ApiError, BuyEntryRequest>(
    "/arenas/:id/entry",
    requireAuth,
    async (req, res) => {
      const arenaId = req.params.id;
      const arena = await arenaRepository.findById(arenaId);
      if (!arena) {
        notFound(res, "Arena not found");
        return;
      }
      if (arena.status !== "lobby") {
        res.status(409).json({ error: "arena_not_joinable", message: "Arena has already started or finished" });
        return;
      }

      const { txSignature } = req.body;
      if (!txSignature) {
        res.status(400).json({ error: "bad_request", message: "txSignature is required" });
        return;
      }

      const userId = (req as unknown as AuthedRequest).userId;
      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(401).json({ error: "unauthorized", message: "user not found" });
        return;
      }

      const entryPass = await entryPassRepository.create({
        arenaId,
        userId,
        walletAddress: user.walletAddress,
        amountLamports: arena.entryFeeLamports,
        txSignature,
      });
      const player = await arenaPlayerRepository.join(arenaId, userId);
      await arenaRepository.bumpActivePlayers(arenaId, 1);
      // Keeps the live runtime's roster (leaderboard + ArenaPlayerStore) in sync with the DAL —
      // a no-op if this arena has no running runtime yet, or the player already joined.
      runtimeLookup.getRuntime(arenaId)?.join(userId, user.username, player.joinedAt);

      const updatedArena = (await arenaRepository.findById(arenaId)) ?? arena;
      const body: BuyEntryResponse = { entryPassId: entryPass.id, player, arena: updatedArena };
      res.json(body);
    },
  );

  /** POST /rounds/:id/answer — submit/change answer while open (spec §5, §9). */
  router.post<{ id: string }, SubmitAnswerResponse | ApiError, SubmitAnswerRequest>(
    "/rounds/:id/answer",
    requireAuth,
    async (req, res) => {
      const { answer } = req.body;
      if (answer !== "yes" && answer !== "no") {
        res.status(400).json({ error: "bad_request", message: "answer must be yes|no" });
        return;
      }

      const roundId = req.params.id;
      const round = await predictionRoundRepository.findById(roundId);
      if (!round) {
        notFound(res, "Round not found");
        return;
      }
      const runtime = runtimeLookup.getRuntime(round.arenaId);
      if (!runtime) {
        notFound(res, "Arena runtime not found");
        return;
      }

      const userId = (req as unknown as AuthedRequest).userId;
      const outcome = runtime.submitAnswer(userId, roundId, answer);
      if (!outcome.ok) {
        if (outcome.reason === "round_not_found") {
          notFound(res, "Round not found");
        } else {
          res.status(409).json({ error: "round_locked", message: "Round is no longer open" });
        }
        return;
      }
      res.json({ roundId, answer, receivedAt: outcome.receivedAt });
    },
  );

  router.get<{ id: string }, LeaderboardResponse | ApiError>("/arenas/:id/leaderboard", async (req, res) => {
    const arena = await arenaRepository.findById(req.params.id);
    if (!arena) {
      notFound(res, "Arena not found");
      return;
    }
    const runtime = runtimeLookup.getRuntime(arena.id);
    const entries = runtime?.leaderboardSnapshot() ?? [];
    const winners = runtime?.finalWinners();
    res.json({ entries, ...(winners !== undefined ? { winners } : {}) });
  });

  /**
   * GET /arenas/:id/rounds — round history (F4 Match Summary). Every round the arena has created,
   * each carrying every player's Prediction — but only once that round is `settled`; an open or
   * locked round reports an empty `predictions` array, since individual answers are never
   * revealed before settle (spec §8).
   */
  router.get<{ id: string }, ArenaRoundsResponse | ApiError>("/arenas/:id/rounds", async (req, res) => {
    const arena = await arenaRepository.findById(req.params.id);
    if (!arena) {
      notFound(res, "Arena not found");
      return;
    }

    const rounds = await predictionRoundRepository.listByArenaId(arena.id);
    const withPredictions: RoundWithPredictions[] = await Promise.all(
      rounds.map(async (round) => ({
        round,
        predictions: round.status === "settled" ? await predictionRepository.listByRoundId(round.id) : [],
      })),
    );
    res.json({ rounds: withPredictions });
  });

  // Fallthrough — matches the ApiError shape (spec S2) for anything not implemented above.
  router.use((req, res) => {
    notFound(res, `No route for ${req.method} ${req.path}`);
  });

  return router;
}
