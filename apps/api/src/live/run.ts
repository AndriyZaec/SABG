// Entrypoint for the live TXODDS SSE worker (mirrors world-cup's src/worker.ts). Run via
// `pnpm live:dev` (apps/api) or `pnpm --filter @arena/api live:dev`.

import { GuestJwtService } from "./auth/guest-jwt.service.js";
import { TxLineService } from "./auth/txline.service.js";
import { MongoService } from "./mongo/mongo.service.js";
import { ensureIndexes } from "./mongo/ensure-indexes.js";
import { LiveIngestionWorker } from "./worker.js";
import { liveConfig } from "./config/env.js";
import { logger } from "./logger.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { FIXTURE_MATCH_ID } from "../ingestion/replay.js";
import { MatchStateEngine } from "../match-state/engine.js";
import { RoundEngine } from "../round-engine/engine.js";
import { SettlementEngine } from "../settlement/engine.js";
import { createInMemoryArenaPlayerStore } from "../settlement/arena-player-store.js";
import { createInMemoryPredictionStore } from "../settlement/prediction-store.js";

/** Placeholder arena id for standalone runs (no real Arena row exists for this fixture yet). */
const FIXTURE_ARENA_ID = "00000000-0000-0000-0000-000000000000";

/** Placeholder players for standalone runs (no real join flow exists yet) — see B4 seeding below. */
const FIXTURE_PLAYER_ANSWERS_YES = "00000000-0000-0000-0000-000000000001";
const FIXTURE_PLAYER_ANSWERS_NO = "00000000-0000-0000-0000-000000000002";
const FIXTURE_PLAYER_NEVER_ANSWERS = "00000000-0000-0000-0000-000000000003";

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

const bus = new MatchSignalBus();
// B2 Match State Engine: keeps the aggregated match snapshot and logs it on every change, so
// the worker is observable when run standalone (B7 will subscribe the same way to push WS
// match.state instead of logging).
const matchStateEngine = new MatchStateEngine(FIXTURE_MATCH_ID, (state) => {
  logger.info({ state }, "match state updated");
});
matchStateEngine.subscribeTo(bus);

// B4 Settlement Engine seams: no real answer-submission/join API exists yet, so seed a few
// scripted players (one always correct-ish, one always wrong-ish, one who never answers) purely
// to exercise correct/incorrect/missed when run standalone. Forward-declared so RoundEngine's
// onTransition can bridge "lock" -> settlementEngine.onRoundLocked (B3 -> B4).
const predictionStore = createInMemoryPredictionStore();
const arenaPlayerStore = createInMemoryArenaPlayerStore(FIXTURE_ARENA_ID, [
  FIXTURE_PLAYER_ANSWERS_YES,
  FIXTURE_PLAYER_ANSWERS_NO,
  FIXTURE_PLAYER_NEVER_ANSWERS,
]);
let settlementEngine: SettlementEngine;

// B3 Round Engine: drives round lifecycle (pending -> open -> locked) off the same match clock,
// logging transitions for now (B7 will push these over WS instead). Stub question provider until
// B5 lands; matchState context comes from the engine above.
const roundEngine = new RoundEngine(FIXTURE_MATCH_ID, FIXTURE_ARENA_ID, {
  getMatchState: () => matchStateEngine.snapshot,
  onTransition: (event) => {
    logger.info({ event }, "round lifecycle event");
    if (event.type === "open") {
      predictionStore.recordAnswer(event.round.id, FIXTURE_PLAYER_ANSWERS_YES, "yes");
      predictionStore.recordAnswer(event.round.id, FIXTURE_PLAYER_ANSWERS_NO, "no");
      // FIXTURE_PLAYER_NEVER_ANSWERS deliberately never gets a recorded answer.
    } else if (event.type === "lock") {
      const round = roundEngine.roundsByWindow.get(event.windowStartMinute);
      if (round !== undefined) settlementEngine.onRoundLocked(round);
    }
  },
});
roundEngine.subscribeTo(bus);

// B4 Settlement Engine: resolves each locked round (early on a confirmed matching event,
// window-end otherwise, spec §6), logs the outcome, and updates the round back through B3's
// single source of truth (RoundEngine.markSettled) so PredictionRound stays authoritative.
settlementEngine = new SettlementEngine(FIXTURE_ARENA_ID, {
  predictionStore,
  arenaPlayerStore,
  onSettled: (event) => {
    roundEngine.markSettled(event.windowStartMinute, event.correctAnswer, event.settledBy);
    logger.info({ event }, "round settled");
  },
  onPlayerResult: (event) => {
    logger.info({ event }, "player result");
  },
});
settlementEngine.subscribeTo(bus);

const fixtureId = liveConfig.txodds.fixtureId;
const worker = new LiveIngestionWorker(FIXTURE_MATCH_ID, bus);

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
