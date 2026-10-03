import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client.js";
import { closeHttpServer, listenHttpServer } from "../gateway/http-lifecycle.js";
import { logger } from "../gateway/logger.js";
import { createGatewayServer } from "../gateway/server.js";
import { WriteQueue } from "../gateway/stores/write-queue.js";
import { MongoService } from "../grid/mongo/mongo.service.js";
import { startScheduler, stopScheduler, type Scheduler } from "../scheduler/index.js";
import { Cs2Autopilot, createCs2AutopilotDeps, registerCs2AutopilotJobs } from "./autopilot.js";
import { cs2Config } from "./config/env.js";

const CS2_ENTRY_FEE_LAMPORTS = 10_000_000;

async function main(): Promise<void> {
  const abortController = new AbortController();
  const writeQueue = new WriteQueue();
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
  let autopilot: Cs2Autopilot | undefined;
  let scheduler: Scheduler | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    abortController.abort();
    shutdownPromise = (async () => {
      logger.info({ signal }, "cs2: runtime shutting down");
      // No new launches or GRID polls, then no new client writes; the series lock goes last.
      await autopilot?.stopPolling();
      if (scheduler !== undefined) await stopScheduler(scheduler);
      await gatewayServer?.wsGateway.close();
      if (gatewayServer !== undefined) await closeHttpServer(gatewayServer.httpServer);
      await autopilot?.stop();
      await writeQueue.drain();
      await closeDatabaseConnection();
      if (cs2Config.rawRecordingEnabled) await MongoService.quit();
      logger.info({ signal }, "cs2: runtime shutdown complete");
    })();
    return shutdownPromise;
  };
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((err: unknown) => {
      logger.error({ err, signal }, "cs2: runtime shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  process.once("SIGINT", () => handleSignal("SIGINT"));

  try {
    await checkDatabaseConnection();
    if (abortController.signal.aborted) return;
    gatewayServer = createGatewayServer({
      runtimeConfig: { gameSource: "catalog", sourceLabel: "CS2 SCHEDULE" },
    });
    autopilot = new Cs2Autopilot(createCs2AutopilotDeps({
      wsGateway: gatewayServer.wsGateway,
      writeQueue,
      entryFeeLamports: CS2_ENTRY_FEE_LAMPORTS,
      rawRecordingEnabled: cs2Config.rawRecordingEnabled,
    }));
    await listenHttpServer(gatewayServer.httpServer, cs2Config.gatewayPort, abortController.signal);
    if (abortController.signal.aborted) return;
    logger.info({ port: cs2Config.gatewayPort }, "cs2: runtime listening");

    const launcher = autopilot;
    scheduler = await startScheduler({ registerJobs: (boss) => registerCs2AutopilotJobs(boss, launcher) });
    // A signal during startup already ran shutdown() without the scheduler.
    if (abortController.signal.aborted) return await stopScheduler(scheduler);

    // In the background: resuming waits on GRID without a deadline, and the site and refunds must not.
    // Joins that land first are seated in the DB, and restore() reads the roster from there.
    void launcher.resume().catch((err: unknown) => logger.error({ err }, "autopilot: resume failed"));
  } catch (err) {
    const interruptedBySignal = abortController.signal.aborted;
    await shutdown("runtime failure").catch(() => undefined);
    if (interruptedBySignal) return;
    throw err;
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "cs2: fatal runtime startup error");
  process.exitCode = 1;
});
