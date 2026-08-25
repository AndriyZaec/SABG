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
  PrepareEntryRequest,
  PrepareEntryResponse,
  RoundWithPredictions,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  SubmitEntryRequest,
  SubmitEntryResponse,
  WalletNonceRequest,
  WalletNonceResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { verifyWalletSignInRequest } from "@arena/auth";
import { userRepository } from "../db/repositories/user.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { arenaPlayerRepository } from "../db/repositories/arena-player.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { predictionRepository } from "../db/repositories/prediction.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { issueToken, requireAuth, type AuthedRequest } from "./auth.js";
import { issueNonce, consumeNonce } from "./nonce-store.js";
import { beginEntrySubmission, stashPrepare, takePrepare } from "./entry-prepare-store.js";
import {
  buildEntryTx,
  isOnchainArenaProvisioningEnabled,
  isValidSolanaWalletAddress,
  submitEntryTx,
  verifyPreparedEntryTransaction,
} from "../onchain/index.js";
import { gatewayConfig } from "./config.js";
import { logger } from "./logger.js";
import type { ArenaRuntimeLookup } from "./arena-runtime.js";

function notFound(res: Response, message: string): void {
  res.status(404).json({ error: "not_found", message } satisfies ApiError);
}

export function createRestRouter(runtimeLookup: ArenaRuntimeLookup): RouterType {
  const router = Router();

  router.post<Record<string, never>, WalletNonceResponse | ApiError, WalletNonceRequest>(
    "/auth/nonce",
    (req, res) => {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        res.status(400).json({ error: "bad_request", message: "walletAddress is required" });
        return;
      }
      res.json({ nonce: issueNonce(walletAddress) });
    },
  );

  // Disabling signature verification restores insecure address-only authentication for demos.
  router.post<Record<string, never>, WalletSignInResponse | ApiError, WalletSignInRequest>(
    "/auth/wallet",
    async (req, res) => {
      const { walletAddress, message, signature } = req.body;
      if (!walletAddress) {
        res.status(400).json({ error: "bad_request", message: "walletAddress is required" });
        return;
      }

      if (gatewayConfig.auth.requireSignature) {
        if (!message || !signature) {
          res.status(400).json({ error: "bad_request", message: "message and signature are required" });
          return;
        }
        if (!verifyWalletSignInRequest({ walletAddress, message, signature })) {
          res.status(401).json({ error: "unauthorized", message: "invalid signature" });
          return;
        }
        if (!consumeNonce(walletAddress, message)) {
          res.status(401).json({ error: "unauthorized", message: "invalid or expired nonce" });
          return;
        }
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

  // This endpoint's persisted API shape is a bare Match, not { match }.
  router.get<{ id: string }>("/matches/:id", async (req, res) => {
    const match = await matchRepository.findById(req.params.id);
    if (!match) {
      notFound(res, "Match not found");
      return;
    }
    res.json(match);
  });

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
      ...(runtime?.matchState !== undefined ? { matchState: runtime.matchState } : {}),
      ...(runtime?.currentRound !== undefined ? { currentRound: runtime.currentRound } : {}),
    };
    res.json(body);
  });

  // This route trusts the reported transaction signature without on-chain verification.
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
      if (isOnchainArenaProvisioningEnabled() || arena.onchainArenaId != null) {
        res.status(409).json({
          error: "arena_not_onchain",
          message: "Use the prepare/submit entry flow for an on-chain arena",
        });
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
      await arenaRepository.bumpPrizePool(arenaId, arena.entryFeeLamports);
      runtimeLookup.getRuntime(arenaId)?.join(userId, user.username, player.joinedAt);

      const updatedArena = (await arenaRepository.findById(arenaId)) ?? arena;
      const body: BuyEntryResponse = { entryPassId: entryPass.id, player, arena: updatedArena };
      res.json(body);
    },
  );

  // The wallet signature authorizes this flow; no session token exists until submission.
  router.post<{ id: string }, PrepareEntryResponse | ApiError, PrepareEntryRequest>(
    "/arenas/:id/entry/prepare",
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
      const { walletAddress } = req.body;
      if (!walletAddress) {
        res.status(400).json({ error: "bad_request", message: "walletAddress is required" });
        return;
      }
      if (!(await isValidSolanaWalletAddress(walletAddress))) {
        res.status(400).json({ error: "bad_request", message: "walletAddress is not a valid Solana address" });
        return;
      }

      try {
        const provisionedArena =
          arena.onchainArenaId == null ? await arenaRepository.ensureOnchain(arenaId) : arena;
        if (provisionedArena.onchainArenaId == null) {
          res.status(409).json({ error: "arena_not_onchain", message: "Arena is not provisioned on-chain" });
          return;
        }
        const tx = await buildEntryTx(provisionedArena.onchainArenaId, walletAddress);
        const prepareId = stashPrepare(arenaId, walletAddress, tx);
        res.json({ prepareId, tx });
      } catch (err: unknown) {
        logger.error({ err, arenaId }, "entry prepare failed");
        res.status(502).json({ error: "onchain_error", message: "Failed to build entry transaction" });
      }
    },
  );

  // Re-check joinability before payment and return an existing seat on exact retries.
  router.post<{ id: string }, SubmitEntryResponse | ApiError, SubmitEntryRequest>(
    "/arenas/:id/entry/submit",
    async (req, res) => {
      const arenaId = req.params.id;
      const { prepareId, signedTx } = req.body;
      if (!prepareId || !signedTx) {
        res.status(400).json({ error: "bad_request", message: "prepareId and signedTx are required" });
        return;
      }

      const pending = takePrepare(prepareId);
      if (!pending || pending.arenaId !== arenaId) {
        res.status(400).json({ error: "bad_request", message: "Unknown or expired prepareId" });
        return;
      }

      const arena = await arenaRepository.findById(arenaId);
      if (!arena) {
        notFound(res, "Arena not found");
        return;
      }

      // Kickoff waits for accepted submissions to finish payment and DB seating.
      const runtime = runtimeLookup.getRuntime(arenaId);
      const joinable = arena.status === "lobby";
      if (!joinable) {
        res.status(409).json({ error: "arena_not_joinable", message: "Arena is no longer joinable" });
        return;
      }
      const finishSubmission = beginEntrySubmission(arenaId);
      if (!finishSubmission) {
        res.status(409).json({ error: "arena_not_joinable", message: "Arena is closing its lobby" });
        return;
      }
      try {
        const user = await userRepository.upsertByWallet(
          pending.walletAddress,
          `fan_${pending.walletAddress.slice(0, 6)}`,
        );

        // Reconciliation must return an existing seat without buying again.
        const existing = await entryPassRepository.findByArenaAndUser(arenaId, user.id);
        if (existing) {
          const player = await arenaPlayerRepository.join(arenaId, user.id);
          runtime?.join(user.id, user.username, player.joinedAt);
          res.json({ token: issueToken(user.id), entryPassId: existing.id, player, arena });
          return;
        }

        const verification = await verifyPreparedEntryTransaction(pending.tx, signedTx, pending.walletAddress);
        if (!verification.ok) {
          logger.warn({ arenaId, reason: verification.reason }, "prepared entry transaction rejected");
          res.status(400).json({ error: "bad_request", message: "signedTx does not match the prepared entry" });
          return;
        }
        if (verification.blockhashRefreshed) {
          logger.info({ arenaId }, "entry wallet refreshed the transaction blockhash");
        }

        let signature: string;
        try {
          signature = await submitEntryTx(signedTx);
        } catch (err: unknown) {
          logger.error({ err, arenaId, wallet: pending.walletAddress }, "entry submit failed on-chain");
          res.status(502).json({ error: "onchain_submit_failed", message: "Entry transaction failed on-chain" });
          return;
        }

        const entryPass = await entryPassRepository.create({
          arenaId,
          userId: user.id,
          walletAddress: user.walletAddress,
          amountLamports: arena.entryFeeLamports,
          txSignature: signature,
        });
        const player = await arenaPlayerRepository.join(arenaId, user.id);
        await arenaRepository.bumpActivePlayers(arenaId, 1);
        await arenaRepository.bumpPrizePool(arenaId, arena.entryFeeLamports);
        runtime?.join(user.id, user.username, player.joinedAt);

        const updatedArena = (await arenaRepository.findById(arenaId)) ?? arena;
        res.json({ token: issueToken(user.id), entryPassId: entryPass.id, player, arena: updatedArena });
      } finally {
        finishSubmission();
      }
    },
  );

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
        switch (outcome.reason) {
          case "round_not_found":
            notFound(res, "Round not found");
            return;
          case "not_participant":
            res.status(403).json({ error: "not_participant", message: "Only active arena participants can submit predictions" });
            return;
          case "eliminated":
            res.status(403).json({ error: "eliminated", message: "Eliminated players cannot submit predictions" });
            return;
          case "round_locked":
            res.status(409).json({ error: "round_locked", message: "Round is no longer open" });
            return;
        }
        outcome.reason satisfies never;
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

  // Never reveal individual predictions before settlement.
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

  router.use((req, res) => {
    notFound(res, `No route for ${req.method} ${req.path}`);
  });

  return router;
}
