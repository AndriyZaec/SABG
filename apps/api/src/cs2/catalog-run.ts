import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client.js";
import { closeHttpServer, listenHttpServer } from "../gateway/http-lifecycle.js";
import { logger } from "../gateway/logger.js";
import { createGatewayServer } from "../gateway/server.js";
import { startScheduler, stopScheduler, type Scheduler } from "../scheduler/index.js";
import { cs2Config } from "./config/env.js";

if (cs2Config.mode !== "catalog") {
  throw new Error("CS2 catalog runtime requires CS2_RUNTIME_MODE=catalog");
}

async function main(): Promise<void> {
  const abortController = new AbortController();
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
  let scheduler: Scheduler | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    abortController.abort();
    shutdownPromise = (async () => {
      logger.info({ signal }, "cs2: catalog runtime shutting down");
      await gatewayServer?.wsGateway.close();
      if (gatewayServer !== undefined) await closeHttpServer(gatewayServer.httpServer);
      if (scheduler !== undefined) await stopScheduler(scheduler);
      await closeDatabaseConnection();
      logger.info({ signal }, "cs2: catalog runtime shutdown complete");
    })();
    return shutdownPromise;
  };
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((err: unknown) => {
      logger.error({ err, signal }, "cs2: catalog runtime shutdown failed");
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
      runtimeConfig: { gameSource: "catalog", sourceLabel: "CS2 SCHEDULE" },
    });
    await listenHttpServer(gatewayServer.httpServer, cs2Config.gatewayPort, abortController.signal);
    logger.info({ port: cs2Config.gatewayPort }, "cs2: catalog runtime listening without GRID polling");
  } catch (err) {
    const interruptedBySignal = abortController.signal.aborted;
    await shutdown("runtime failure").catch(() => undefined);
    if (interruptedBySignal) return;
    throw err;
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "cs2: fatal catalog runtime startup error");
  process.exitCode = 1;
});
