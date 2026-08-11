// Bootstrap for the Grid.gg CS2 series-state poller/recorder. Mirrors src/live/preflight.ts's
// startup shape: connect Mongo, start the recorder, and shut down cleanly on signal.

import { MongoService } from "./mongo/mongo.service.js";
import { GridRecorder } from "./recorder.js";
import { logger } from "./logger.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "grid: unhandled rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "grid: uncaught exception");
});

async function main(): Promise<void> {
  await MongoService.getDb();

  const recorder = new GridRecorder();
  recorder.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "grid: shutdown requested");
    await recorder.shutdown();
    await MongoService.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error({ err }, "grid: fatal startup error");
  process.exit(1);
});
