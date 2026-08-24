// CS2 live poller + gateway entrypoint. Run via `pnpm cs2:live:dev` (apps/api). Its own process,
// own port (CS2_GATEWAY_PORT) — separate from soccer's `gateway/run.ts`, sharing only Postgres
// and the generic gateway/{rest,ws,auth,event-access,server}.ts modules (all confirmed
// discipline-agnostic — no CS2-specific fork of any of them exists or is needed). Mirrors
// grid/run.ts's bootstrap shape and gateway/run.ts's graceful-shutdown care (AbortController,
// abort-then-settle, suppress the "failure" when the abort itself came from a signal).
//
// AUTH_SECRET/CORS_ORIGINS/EVENT_ACCESS_CODE_HASH are deliberately shared with soccer's
// gateway/config.ts singleton, not duplicated — see cs2/config/env.ts's doc comment. Tokens are
// scoped only to userId (auth.ts), not to an arena or discipline, so sharing the secret between
// the two processes' cookies/tokens is safe and avoids same-host cookie collisions.
//
// Bootstrap does one "priming" poll (retried on the shared backoff, grid/backoff.ts) to learn the
// Series' format before anything else can happen — Cs2SeriesOrchestrator needs a real `Series`
// row up front, and `seriesRepository.upsertByGridSeriesId` requires `format` NOT NULL. GRID's
// seriesState never exposes a scheduled kickoff time, so that's env-supplied
// (CS2_SCHEDULED_START_TIME, cs2/config/env.ts) — the CS2 equivalent of soccer's TXODDS fixture
// start time. The HTTP/WS server listens before the poller starts, so the very first Arena
// (opened as soon as the poller reaches scheduledStartTime - 10min) is already joinable.
//
// Optionally records every raw GRID poll response to Mongo (cs2/raw-recorder.ts) when
// CS2_RAW_RECORDING_ENABLED=true — best-effort, never blocks or fails the live flow.

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
import { WriteQueue } from "../gateway/stores/write-queue.js";
import { createGatewayServer } from "../gateway/server.js";
import { closeHttpServer, listenHttpServer } from "../gateway/http-lifecycle.js";
import { cs2Config } from "./config/env.js";
import { Cs2LivePoller } from "./live-poller.js";
import { parseSeriesSnapshot } from "./series-snapshot.js";
import { Cs2SeriesOrchestrator } from "./series-orchestrator.js";
import { Cs2RawRecorder } from "./raw-recorder.js";
import { MongoService } from "../grid/mongo/mongo.service.js";

const CS2_ENTRY_FEE_LAMPORTS = 10_000_000;

/** Polls until a Series-level snapshot with a parseable `format` arrives, or `signal` aborts. */
async function primeSeriesFormat(client: GridClient, signal: AbortSignal): Promise<number | undefined> {
  let errorStreak = 0;
  while (!signal.aborted) {
    try {
      const result = await client.fetchSeriesState(signal);
      const snapshot = parseSeriesSnapshot(result.data);
      if (snapshot?.format !== undefined) return snapshot.format;
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
    const format = await primeSeriesFormat(client, abortController.signal);
    if (abortController.signal.aborted || format === undefined) return;

    const series = await seriesRepository.upsertByGridSeriesId(gridConfig.grid.seriesId, {
      format,
      scheduledStartTime: new Date(cs2Config.scheduledStartTime),
    });
    if (abortController.signal.aborted) return;
    logger.info({ seriesId: series.id, gridSeriesId: series.gridSeriesId, format }, "cs2: series ready");

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

    // Listen before the poller starts — the very first Arena it opens must already be joinable.
    await listenHttpServer(httpServer, cs2Config.gatewayPort, abortController.signal);
    if (abortController.signal.aborted) return;
    logger.info({ port: cs2Config.gatewayPort }, `cs2: gateway listening — REST/WS http://localhost:${cs2Config.gatewayPort}`);

    let rawRecorder: Cs2RawRecorder | undefined;
    if (cs2Config.rawRecordingEnabled) {
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
