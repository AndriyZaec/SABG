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

/** Placeholder arena id for standalone runs (no real Arena row exists for this fixture yet). */
const FIXTURE_ARENA_ID = "00000000-0000-0000-0000-000000000000";

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

// B3 Round Engine: drives round lifecycle (pending -> open -> locked) off the same match clock,
// logging transitions for now (B7 will push these over WS instead). Stub question provider until
// B5 lands; matchState context comes from the engine above.
const roundEngine = new RoundEngine(FIXTURE_MATCH_ID, FIXTURE_ARENA_ID, {
  getMatchState: () => matchStateEngine.snapshot,
  onTransition: (event) => {
    logger.info({ event }, "round lifecycle event");
  },
});
roundEngine.subscribeTo(bus);

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
