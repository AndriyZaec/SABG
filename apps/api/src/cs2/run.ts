import { GridClient } from "../grid/grid-client.js";
import { gridConfig } from "../grid/config/env.js";
import { logger } from "../grid/logger.js";
import { nextBackoffMs } from "../grid/backoff.js";
import { sleep } from "../shared/sleep.js";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
  tryAcquireSeriesRuntimeLock,
  type ReleaseFixtureRuntimeLock,
} from "../db/client.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import { cs2IdentityRepository } from "../db/repositories/cs2-identity.repository.js";
import { WriteQueue } from "../gateway/stores/write-queue.js";
import { createGatewayServer } from "../gateway/server.js";
import { closeHttpServer, listenHttpServer } from "../gateway/http-lifecycle.js";
import { cs2Config } from "./config/env.js";
import { Cs2LivePoller } from "./live-poller.js";
import { parseGridSeriesSnapshot, type GridCs2SeriesSnapshot } from "./series-snapshot.js";
import { Cs2SeriesOrchestrator } from "./series-orchestrator.js";
import { Cs2RawRecorder } from "./raw-recorder.js";
import { MongoService } from "../grid/mongo/mongo.service.js";
import { buildCs2TeamIdentityMap } from "./team-identity.js";

const CS2_ENTRY_FEE_LAMPORTS = 10_000_000;

if (cs2Config.mode !== "live") {
  throw new Error("CS2 live runtime requires CS2_RUNTIME_MODE=live");
}
const liveConfig = cs2Config;

async function primeSeries(client: GridClient, signal: AbortSignal): Promise<GridCs2SeriesSnapshot | undefined> {
  let errorStreak = 0;
  while (!signal.aborted) {
    try {
      const result = await client.fetchSeriesState(signal);
      const snapshot = parseGridSeriesSnapshot(result.data);
      if (snapshot?.format !== undefined) return snapshot;
      logger.warn("cs2: priming poll had no parseable Series format yet — retrying");
      errorStreak = 0;
    } catch (err) {
      logger.error({ err }, "cs2: priming poll failed");
      errorStreak += 1;
    }
    await sleep(errorStreak > 0 ? nextBackoffMs(errorStreak) : gridConfig.grid.pollIntervalMs, signal);
  }
  return undefined;
}

async function main(): Promise<void> {
  const abortController = new AbortController();
  const writeQueue = new WriteQueue();
  let releaseLock: ReleaseFixtureRuntimeLock | undefined;
  let poller: Cs2LivePoller | undefined;
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    abortController.abort();
    shutdownPromise = (async () => {
      logger.info({ signal }, "cs2: shutting down");
      await poller?.shutdown();
      await gatewayServer?.wsGateway.close();
      if (gatewayServer !== undefined) await closeHttpServer(gatewayServer.httpServer);
      await writeQueue.drain();
      await releaseLock?.();
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

    releaseLock = await tryAcquireSeriesRuntimeLock(gridConfig.grid.seriesId);
    if (!releaseLock) {
      throw new Error(`Series ${gridConfig.grid.seriesId} already has an active CS2 live poller`);
    }
    if (abortController.signal.aborted) return;

    const client = new GridClient();
    const primedSeries = await primeSeries(client, abortController.signal);
    if (abortController.signal.aborted || primedSeries?.format === undefined) return;

    const series = await seriesRepository.upsertByGridSeriesId(gridConfig.grid.seriesId, {
      format: primedSeries.format,
      scheduledStartTime: new Date(liveConfig.scheduledStartTime),
    });
    if (abortController.signal.aborted) return;
    const persistedTeams = await cs2IdentityRepository.synchronizeSeriesTeams(series.id, primedSeries.teams);
    const teamIdentities = buildCs2TeamIdentityMap(persistedTeams);
    logger.info({ seriesId: series.id, gridSeriesId: series.gridSeriesId, format: primedSeries.format }, "cs2: series ready");

    gatewayServer = createGatewayServer({
      runtimeConfig: { gameSource: "live", sourceLabel: "CS2 LIVE FEED" },
    });
    const { httpServer, wsGateway } = gatewayServer;

    const orchestrator = await Cs2SeriesOrchestrator.create(series, {
      writeQueue,
      entryFeeLamports: CS2_ENTRY_FEE_LAMPORTS,
      broadcaster: wsGateway,
      onArenaOpened: (arenaId, runtime) => wsGateway.registerRuntime(arenaId, runtime),
    });

    // Accept joins before polling can open the first arena.
    await listenHttpServer(httpServer, liveConfig.gatewayPort, abortController.signal);
    if (abortController.signal.aborted) return;
    logger.info({ port: liveConfig.gatewayPort }, `cs2: gateway listening — REST/WS http://localhost:${liveConfig.gatewayPort}`);

    let rawRecorder: Cs2RawRecorder | undefined;
    if (liveConfig.rawRecordingEnabled) {
      if (gridConfig.mongo.uri === undefined) {
        logger.warn("cs2: CS2_RAW_RECORDING_ENABLED is true but MONGODB_URI is unset — running without raw recording");
      } else {
        rawRecorder = new Cs2RawRecorder(gridConfig.grid.seriesId);
      }
    }

    poller = new Cs2LivePoller({
      target: orchestrator,
      fetchSeriesState: (signal) => client.fetchSeriesState(signal),
      pollIntervalMs: gridConfig.grid.pollIntervalMs,
      teamIdentities,
      rawRecorder,
    });
    poller.start();
    logger.info({ gridSeriesId: series.gridSeriesId }, "cs2: live poller started");
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
