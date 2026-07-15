// Live ingestion worker entrypoint. Run via `pnpm live:dev` (apps/api).
//
// Drives the real engine pipeline via `ArenaRuntime` (the same source-agnostic composition root
// gateway/run.ts uses) off the live TXODDS `/scores/stream` feed instead of a recorded fixture.
// Bots join through the real, DB-backed flow — `userRepository.upsertByWallet` +
// `entryPassRepository.create` + `runtime.join(...)`, mirroring POST /arenas/:id/entry
// (gateway/rest.ts) — rather than a hardcoded in-memory roster. Needs Postgres in addition to
// Mongo/TxLINE.

import type { Answer, PredictionRound, ServerMessage, Uuid } from "@arena/contracts";
import { GuestJwtService } from "./auth/guest-jwt.service.js";
import { TxLineService } from "./auth/txline.service.js";
import { MongoService } from "./mongo/mongo.service.js";
import { ensureIndexes } from "./mongo/ensure-indexes.js";
import { LiveIngestionWorker } from "./worker.js";
import { liveConfig } from "./config/env.js";
import { logger } from "./logger.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { ArenaRuntime, type ArenaPersistence, type GatewayBroadcaster } from "../gateway/arena-runtime.js";
import { WriteQueue } from "../gateway/stores/write-queue.js";
import { createPgPredictionStore } from "../gateway/stores/pg-prediction-store.js";
import { createPgArenaPlayerStore } from "../gateway/stores/pg-arena-player-store.js";
import { resolveFixtureTeams } from "../db/seeds/fixture-metadata.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { userRepository } from "../db/repositories/user.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { payoutService } from "../payout/index.js";
import { createBots } from "../replay/bots.js";

const LIVE_ENTRY_FEE_LAMPORTS = 10_000_000;
const LIVE_BOT_COUNT = 3;

interface LiveBot {
  userId: Uuid;
  answerFor(round: PredictionRound): Answer;
}

function botWallet(index: number): string {
  return `live-demo-bot-wallet-${index}`;
}

/**
 * Joins each scripted bot through the real entry flow — a real `users` row (wallet upsert), a
 * real `entry_pass` row, the arena's active-player count, then `runtime.join(...)` (what
 * POST /arenas/:id/entry calls) — while the arena is still `lobby` (spec §9: pre-kickoff only).
 * Idempotent across restarts: `upsertByWallet` returns the same user for the same bot wallet, and
 * the entry-pass/active-count writes are skipped once that user has already entered this arena.
 */
async function joinBots(arenaId: Uuid, runtime: ArenaRuntime): Promise<LiveBot[]> {
  const scripted = createBots(LIVE_BOT_COUNT);
  const bots: LiveBot[] = [];

  for (const [index, bot] of scripted.entries()) {
    const user = await userRepository.upsertByWallet(botWallet(index), bot.username);

    const alreadyEntered = await entryPassRepository.findByArenaAndUser(arenaId, user.id);
    if (alreadyEntered === undefined) {
      await entryPassRepository.create({
        arenaId,
        userId: user.id,
        walletAddress: user.walletAddress,
        amountLamports: LIVE_ENTRY_FEE_LAMPORTS,
        txSignature: `live-demo-bot-${index}`,
      });
      await arenaRepository.bumpActivePlayers(arenaId, 1);
    }

    runtime.join(user.id, user.username, new Date().toISOString());
    bots.push({ userId: user.id, answerFor: bot.answerFor });
  }

  return bots;
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});

// Fail fast: the raw stream store must be reachable and its indexes in place before we
// start streaming.
await MongoService.getDb();
await ensureIndexes();

try {
  await GuestJwtService.getInstance().getJwt();
  await TxLineService.getInstance().getApiToken();
  logger.info("TxLINE API token and guest JWT ready");
} catch (err) {
  logger.error({ err }, "failed to fetch TxLINE API token");
}

const fixtureId = liveConfig.txodds.fixtureId;

// Real names when the fixture is listed in db/seeds/matches.json — the scores feed itself
// carries no team names, only "Home"/"Away" for a fixture that isn't seeded yet.
const teams = resolveFixtureTeams(fixtureId) ?? { homeTeam: "Home", awayTeam: "Away" };
const match = await matchRepository.upsertByTxoddsFixtureId(fixtureId, {
  homeTeam: teams.homeTeam,
  awayTeam: teams.awayTeam,
  startTime: new Date(),
});
const arena = await arenaRepository.upsertForMatch(match.id, {
  entryFeeLamports: LIVE_ENTRY_FEE_LAMPORTS,
  prizePoolLamports: 0,
});
logger.info({ matchId: match.id, arenaId: arena.id, fixtureId }, "live match/arena ready");

const writeQueue = new WriteQueue();
const predictionStore = createPgPredictionStore(arena.id, writeQueue);
const arenaPlayerStore = createPgArenaPlayerStore(arena.id, writeQueue);

const persistence: ArenaPersistence = {
  updateMatchLive(matchId, live) {
    void writeQueue.enqueue(arena.id, () => matchRepository.updateLive(matchId, live));
  },
  upsertRound(round) {
    void writeQueue.enqueue(arena.id, () => predictionRoundRepository.upsert(round).then(() => undefined));
  },
  finishArena(arenaId, winners) {
    void writeQueue.enqueue(arenaId, () => arenaRepository.setStatus(arenaId, "finished"));
    // Release the escrow to winners (no-op for off-chain arenas — see payout service).
    void payoutService.settleArena(arenaId, winners);
  },
};

const bus = new MatchSignalBus();

// Populated by joinBots() below, before the worker starts — the round.open handler reads it live.
let liveBots: LiveBot[] = [];

let runtime!: ArenaRuntime; // assigned below, before any signal on `bus` can fire
const broadcaster: GatewayBroadcaster = {
  broadcast(arenaId, message: ServerMessage) {
    logger.info({ message }, `[broadcast] ${message.type}`);
    if (message.type !== "round.open") return;
    // Every still-active bot answers immediately on open, exactly like the headless replay
    // demo's bots (replay/run.ts) — just against the live match clock instead of an accelerated one.
    const round = message.round;
    for (const bot of liveBots) {
      if (arenaPlayerStore.getStatus(bot.userId) !== "active") continue;
      runtime.submitAnswer(bot.userId, round.id, bot.answerFor(round));
    }
  },
  sendToUser(_arenaId, userId, message: ServerMessage) {
    logger.info({ userId, message }, `[personal] ${message.type}`);
  },
};

runtime = new ArenaRuntime({
  matchId: match.id,
  arenaId: arena.id,
  bus,
  predictionStore,
  arenaPlayerStore,
  // Roster starts empty — bots join below through the real path (runtime.join), same as
  // POST /arenas/:id/entry.
  roster: [],
  broadcaster,
  persistence,
});

liveBots = await joinBots(arena.id, runtime);

// Join is only valid pre-kickoff (spec §9) — flip to "live" now, right before kickoff starts.
await arenaRepository.setStatus(arena.id, "live");

const worker = new LiveIngestionWorker(match.id, bus);

logger.info({ fixtureId }, "starting live ingestion worker");
await worker.start(fixtureId);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down gracefully");

  worker.shutdown();
  await MongoService.quit().catch((err) => logger.warn({ err }, "error closing MongoDB client"));

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
