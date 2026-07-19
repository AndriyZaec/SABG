// Live ingestion worker entrypoint. Run via `pnpm live:dev` (apps/api).
//
// Drives the real engine pipeline via `ArenaRuntime` (the same source-agnostic composition root
// gateway/run.ts uses) off the live TXODDS `/scores/stream` feed instead of a recorded fixture.
// Needs Postgres in addition to Mongo/TxLINE.

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
import { discoverWorldCupFixture } from "./fixture-discovery.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { payoutService } from "../payout/index.js";

const LIVE_ENTRY_FEE_LAMPORTS = 100_000_000;

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

const selectedFixture = await discoverWorldCupFixture({
  ...(liveConfig.txodds.fixtureId !== undefined ? { fixtureId: liveConfig.txodds.fixtureId } : {}),
});
const fixtureId = selectedFixture.fixtureId;
const teams = { homeTeam: selectedFixture.homeTeam, awayTeam: selectedFixture.awayTeam };
const match = await matchRepository.upsertByTxoddsFixtureId(fixtureId, {
  homeTeam: teams.homeTeam,
  awayTeam: teams.awayTeam,
  startTime: new Date(selectedFixture.startTime),
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

// This worker has no WS server, so the transport just logs.
const logBroadcaster: GatewayBroadcaster = {
  broadcast(_arenaId, message) {
    logger.info({ message }, `[broadcast] ${message.type}`);
  },
  sendToUser(_arenaId, userId, message) {
    logger.info({ userId, message }, `[personal] ${message.type}`);
  },
};
const runtime = new ArenaRuntime({
  matchId: match.id,
  arenaId: arena.id,
  bus,
  predictionStore,
  arenaPlayerStore,
  roster: [],
  broadcaster: logBroadcaster,
  persistence,
  teamNames: { home: match.homeTeam, away: match.awayTeam },
});

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
