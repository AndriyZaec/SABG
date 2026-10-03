import { gridConfig } from "../grid/config/env.js";
import { logger } from "../grid/logger.js";
import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client.js";
import { WriteQueue } from "../gateway/stores/write-queue.js";
import { createGatewayServer } from "../gateway/server.js";
import { closeHttpServer, listenHttpServer } from "../gateway/http-lifecycle.js";
import { startScheduler, stopScheduler, type Scheduler } from "../scheduler/index.js";
import { cs2Config } from "./config/env.js";
import { Cs2SeriesRunner, type Cs2SeriesRunnerStartResult } from "./series-runner.js";
import { MongoService } from "../grid/mongo/mongo.service.js";

const CS2_ENTRY_FEE_LAMPORTS = 10_000_000;

if (cs2Config.mode !== "live") {
  throw new Error("CS2 live runtime requires CS2_RUNTIME_MODE=live");
}
const liveConfig = cs2Config;

async function main(): Promise<void> {
  const abortController = new AbortController();
  const writeQueue = new WriteQueue();
  let starting: Promise<Cs2SeriesRunnerStartResult> | undefined;
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
  let scheduler: Scheduler | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    abortController.abort();
    shutdownPromise = (async () => {
      logger.info({ signal }, "cs2: shutting down");
      // An aborted start settles quickly and releases its own lock; the DB must outlive it.
      const started = await starting?.catch(() => undefined);
      const runner = started?.kind === "started" ? started.runner : undefined;
      await runner?.stopPolling();
      await gatewayServer?.wsGateway.close();
      if (gatewayServer !== undefined) await closeHttpServer(gatewayServer.httpServer);
      // The lock goes last, once this process can no longer write to the arenas.
      await runner?.stop();
      await writeQueue.drain();
      if (scheduler !== undefined) await stopScheduler(scheduler);
      await closeDatabaseConnection();
      await MongoService.quit();
      logger.info({ signal }, "cs2: shutdown complete");
    })();
    return shutdownPromise;
  };
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((err: unknown) => {
      logger.error({ err, signal }, "cs2: shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  process.once("SIGINT", () => handleSignal("SIGINT"));

  try {
    await checkDatabaseConnection();
    if (abortController.signal.aborted) return;
    scheduler = await startScheduler();
    // A signal during startup already ran shutdown() without the scheduler.
    if (abortController.signal.aborted) return await stopScheduler(scheduler);

    gatewayServer = createGatewayServer({
      runtimeConfig: { gameSource: "live", sourceLabel: "CS2 LIVE FEED" },
    });
    const { httpServer, wsGateway } = gatewayServer;

    // Accept joins before polling can open the first arena.
    await listenHttpServer(httpServer, liveConfig.gatewayPort, abortController.signal);
    if (abortController.signal.aborted) return;
    logger.info({ port: liveConfig.gatewayPort }, `cs2: gateway listening — REST/WS http://localhost:${liveConfig.gatewayPort}`);

    starting = Cs2SeriesRunner.start({
      gridSeriesId: gridConfig.grid.seriesId,
      scheduledStartTime: liveConfig.scheduledStartTime,
      wsGateway,
      writeQueue,
      entryFeeLamports: CS2_ENTRY_FEE_LAMPORTS,
      rawRecordingEnabled: liveConfig.rawRecordingEnabled,
      signal: abortController.signal,
    });
    const result = await starting;
    if (result.kind === "skipped") {
      // Staying up avoids a restart loop that would re-prime and skip again; the operator switches back to catalog.
      logger.error({ gridSeriesId: gridConfig.grid.seriesId, reason: result.reason }, "cs2: configured series was skipped; nothing to run");
    }
  } catch (err) {
    const interruptedBySignal = abortController.signal.aborted;
    await shutdown("runtime failure").catch(() => undefined);
    if (interruptedBySignal) return;
    throw err;
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "cs2: fatal startup error");
  process.exitCode = 1;
});
