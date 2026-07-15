// Live ingestion worker entrypoint. Run via `pnpm live:dev` (apps/api).
//
// Drives the real engine pipeline via `ArenaRuntime` (the same source-agnostic composition root
// gateway/run.ts uses) off the live TXODDS `/scores/stream` feed instead of a recorded fixture.
// Bots join through the real, DB-backed flow — `userRepository.upsertByWallet` +
// `entryPassRepository.create` + `runtime.join(...)`, mirroring POST /arenas/:id/entry
// (gateway/rest.ts) — rather than a hardcoded in-memory roster. Needs Postgres in addition to
// Mongo/TxLINE.

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
import { payoutService } from "../payout/index.js";
import { joinBots, withBotAnswers, type DemoBot } from "../gateway/demo-bots.js";

const LIVE_ENTRY_FEE_LAMPORTS = 10_000_000;
const LIVE_BOT_COUNT = 3;

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

// Populated by joinBots() below, before the worker starts — the answer wrapper reads it live.
let liveBots: DemoBot[] = [];

let runtime!: ArenaRuntime; // assigned below, before any signal on `bus` can fire
// This worker has no WS server, so the transport just logs; the wrapper makes bots answer on open.
const logBroadcaster: GatewayBroadcaster = {
  broadcast(_arenaId, message) {
    logger.info({ message }, `[broadcast] ${message.type}`);
  },
  sendToUser(_arenaId, userId, message) {
    logger.info({ userId, message }, `[personal] ${message.type}`);
  },
};
const broadcaster = withBotAnswers(logBroadcaster, {
  getBots: () => liveBots,
  getRuntime: () => runtime,
  isActive: (userId) => arenaPlayerStore.getStatus(userId) === "active",
});

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

liveBots = await joinBots(arena.id, runtime, LIVE_BOT_COUNT, LIVE_ENTRY_FEE_LAMPORTS);

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
