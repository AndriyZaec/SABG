// Entrypoint for the live TXODDS SSE worker (mirrors world-cup's src/worker.ts). Run via
// `pnpm live:dev` (apps/api) or `pnpm --filter @arena/api live:dev`.

import { GuestJwtService } from "./auth/guest-jwt.service.js";
import { TxLineService } from "./auth/txline.service.js";
import { MongoService } from "./mongo/mongo.service.js";
import { ensureIndexes } from "./mongo/ensure-indexes.js";
import { LiveIngestionWorker } from "./worker.js";
import { liveConfig } from "./config/env.js";
import { logger } from "./logger.js";
import { LiveEventBus } from "../ingestion/event-bus.js";
import { FIXTURE_MATCH_ID } from "../ingestion/replay.js";

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

const bus = new LiveEventBus();
// No downstream engine consumes the bus yet (B2+ land later) — log every published event so
// the worker is observable when run standalone.
bus.subscribe((event) => {
  logger.info({ eventType: event.eventType, team: event.team, matchMinute: event.matchMinute }, "live event");
});

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
