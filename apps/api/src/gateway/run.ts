// Gateway entrypoint. Run via `pnpm gateway:dev` (apps/api) or
// `pnpm --filter @arena/api gateway:dev`.
//
// Event gateway: drives the real engine pipeline from either a recorded replay or live feed.
// Recorded replay defaults to 18241006 (England v Argentina) and needs no Mongo/TxLINE
// credentials. Override which recorded match plays via
// GATEWAY_REPLAY_FIXTURE_ID (see gateway/config.ts) — it must have a matching
// ingestion/__fixtures__/fixture-<id>.json. The live worker (src/live/run.ts) can drive the same
// ArenaRuntime later; the runtime itself is source-agnostic (just a MatchSignalBus consumer).
//
// Event bootstrap is self-contained: it upserts its own match+arena keyed by `txoddsFixtureId`,
// independent of `db:seed` (whose matches.json seeds a *different* fixture, 18209181, than the
// replay uses — see match.repository.ts's doc comment).

import type { Server as HttpServer } from "node:http";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { gatewayConfig } from "./config.js";
import { logger } from "./logger.js";
import { createGatewayServer } from "./server.js";
import { ArenaRuntime, type ArenaPersistence } from "./arena-runtime.js";
import { WriteQueue } from "./stores/write-queue.js";
import { createPgPredictionStore } from "./stores/pg-prediction-store.js";
import { createPgArenaPlayerStore } from "./stores/pg-arena-player-store.js";
import { payoutService } from "../payout/index.js";
import { sleep } from "../shared/sleep.js";
import { joinBots, withBotAnswers, type ScriptedBot } from "./scripted-bots.js";
import {
  checkDatabaseConnection,
  closeDatabaseConnection,
  tryAcquireFixtureRuntimeLock,
  type ReleaseFixtureRuntimeLock,
} from "../db/client.js";
import { createGameSource, type GameSource } from "./game-source.js";
import { REPLAY_CYCLE_EXIT_CODE, shouldCycleReplay } from "./replay-cycle-policy.js";
import { closeEntrySubmissions } from "./entry-prepare-store.js";

const EVENT_ENTRY_FEE_LAMPORTS = 10_000_000;

async function main(): Promise<void> {
  const abortController = new AbortController();
  const writeQueue = new WriteQueue();
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
  let gameSource: GameSource | undefined;
  let releaseRuntimeLock: ReleaseFixtureRuntimeLock | undefined;
  let activeWork: Promise<unknown> = Promise.resolve();
  let shutdownPromise: Promise<void> | undefined;

  const trackWork = async <T>(work: Promise<T>): Promise<T> => {
    activeWork = work;
    try {
      return await work;
    } finally {
      if (activeWork === work) activeWork = Promise.resolve();
    }
  };

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    abortController.abort();
    shutdownPromise = (async () => {
      logger.info({ signal }, "gateway shutting down");
      const httpClosing = gatewayServer ? closeHttpServer(gatewayServer.httpServer) : Promise.resolve();
      const wsClosing = gatewayServer ? gatewayServer.wsGateway.close() : Promise.resolve();
      const shutdownErrors: unknown[] = [];
      const settle = async (step: string, work: Promise<unknown>) => {
        try {
          await work;
        } catch (err) {
          shutdownErrors.push(err);
          logger.warn({ error: safeError(err), signal, step }, "gateway shutdown step failed");
        }
      };
      await settle("game-source", gameSource?.stop() ?? Promise.resolve());
      await activeWork.catch(() => undefined);
      await settle("websocket", wsClosing);
      await settle("http", httpClosing);
      await settle("write-queue", writeQueue.drain());
      await settle("runtime-lock", releaseRuntimeLock?.() ?? Promise.resolve());
      await settle("postgres", closeDatabaseConnection());
      logger.info({ signal }, "gateway shutdown complete");
      if (shutdownErrors.length > 0) throw new AggregateError(shutdownErrors, "Gateway shutdown was incomplete");
    })();
    return shutdownPromise;
  };
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((err: unknown) => {
      logger.error({ error: safeError(err), signal }, "gateway shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  process.once("SIGINT", () => handleSignal("SIGINT"));

  try {
    gameSource = await trackWork(
      createGameSource({
        kind: gatewayConfig.runtime.gameSource,
        replayFixtureId: gatewayConfig.replay.fixtureId,
        secondsPerMatchMinute: gatewayConfig.clock.secondsPerMatchMinute,
        ...(gatewayConfig.live.fixtureId !== undefined ? { liveFixtureId: gatewayConfig.live.fixtureId } : {}),
        signal: abortController.signal,
      }),
    );
    if (abortController.signal.aborted) return;
    logger.info(
      { source: gameSource.kind, sourceLabel: gameSource.label, fixtureId: gameSource.fixture.fixtureId },
      "game source ready",
    );

    await trackWork(checkDatabaseConnection());
    if (abortController.signal.aborted) return;

    releaseRuntimeLock = await trackWork(tryAcquireFixtureRuntimeLock(gameSource.fixture.fixtureId));
    if (!releaseRuntimeLock) {
      throw new Error(`Fixture ${gameSource.fixture.fixtureId} already has an active gateway runtime`);
    }
    if (abortController.signal.aborted) return;

    const match = await trackWork(
      matchRepository.upsertByTxoddsFixtureId(gameSource.fixture.fixtureId, {
        homeTeam: gameSource.fixture.homeTeam,
        awayTeam: gameSource.fixture.awayTeam,
        startTime: gameSource.fixture.startTime,
      }),
    );
    if (abortController.signal.aborted) return;
    const arena = await trackWork(
      arenaRepository.upsertForMatch(match.id, {
        entryFeeLamports: EVENT_ENTRY_FEE_LAMPORTS,
        prizePoolLamports: 0,
      }),
    );
    if (abortController.signal.aborted) return;
    if (arena.status !== "lobby") {
      throw new Error(
        `Fixture ${gameSource.fixture.fixtureId} already has an arena in status ${arena.status}; run an explicit replay reset before starting`,
      );
    }
    logger.info(
      { matchId: match.id, arenaId: arena.id, fixtureId: gameSource.fixture.fixtureId },
      "event match/arena ready",
    );

    gatewayServer = createGatewayServer();
    const { httpServer, wsGateway } = gatewayServer;
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
        void writeQueue.enqueue(arenaId, async () => {
          await arenaRepository.setStatus(arenaId, "finished");
          // Release the escrow to winners (no-op for off-chain arenas — see payout service).
          await payoutService.settleArena(arenaId, winners);
        });
      },
    };

    const bus = new MatchSignalBus();
    // Bots answer each round via a broadcaster wrapper; getters break the runtime/broadcaster cycle.
    let scriptedBots: ScriptedBot[] = [];
    let runtime!: ArenaRuntime;
    const broadcaster = gatewayConfig.bots.enabled
      ? withBotAnswers(wsGateway, {
          getBots: () => scriptedBots,
          getRuntime: () => runtime,
          isActive: (userId) => arenaPlayerStore.getStatus(userId) === "active",
        })
      : wsGateway;

    runtime = new ArenaRuntime({
      matchId: match.id,
      arenaId: arena.id,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster: [],
      broadcaster,
      persistence,
      ...(gameSource.kind === "replay"
        ? { secondsPerMatchMinute: gatewayConfig.clock.secondsPerMatchMinute }
        : {}),
      teamNames: { home: match.homeTeam, away: match.awayTeam },
    });
    wsGateway.registerRuntime(arena.id, runtime);

    // Live uses this one continuous connection for readiness and match delivery; replay is a no-op.
    await trackWork(gameSource.prepare({ bus, matchId: match.id, signal: abortController.signal }));
    if (abortController.signal.aborted) return;

    // Listen before the lobby window so bots and the browser can join while the arena is still `lobby`.
    await trackWork(listenHttpServer(httpServer, gatewayConfig.port, abortController.signal));
    if (abortController.signal.aborted) return;
    logger.info({ port: gatewayConfig.port }, `gateway listening — REST http://localhost:${gatewayConfig.port}/api, WS ws://localhost:${gatewayConfig.port}/ws`);

    if (gatewayConfig.bots.enabled) {
      scriptedBots = await trackWork(joinBots(arena.id, runtime, gatewayConfig.bots.count, EVENT_ENTRY_FEE_LAMPORTS));
      if (abortController.signal.aborted) return;
      logger.info({ arenaId: arena.id, bots: scriptedBots.length }, "scripted bots joined the lobby");
    }

    // Pre-kickoff lobby window: arena stays `lobby` so the human can buy in + join, then flips `live`.
    const configuredLobbyMs = gatewayConfig.lobby.seconds * 1_000;
    const lobbyMs =
      gameSource.kind === "live"
        ? Math.max(0, Math.min(configuredLobbyMs, gameSource.fixture.startTime.getTime() - Date.now()))
        : configuredLobbyMs;
    logger.info({ arenaId: arena.id, lobbySeconds: lobbyMs / 1_000 }, "lobby open — waiting for players");
    await trackWork(sleep(lobbyMs, abortController.signal));
    if (abortController.signal.aborted) return;
    await trackWork(closeEntrySubmissions(arena.id));
    if (abortController.signal.aborted) return;
    await trackWork(arenaRepository.setStatus(arena.id, "live"));
    if (abortController.signal.aborted) return;
    logger.info({ arenaId: arena.id }, "kickoff — arena live");

    await trackWork(gameSource.run({ bus, matchId: match.id, signal: abortController.signal }));
    if (abortController.signal.aborted) return;
    logger.info({ arenaId: arena.id, source: gameSource.kind }, "game source finished");

    if (shouldCycleReplay(gameSource.kind, gatewayConfig.replay.autoRestart)) {
      await trackWork(writeQueue.drain());
      logger.info(
        { arenaId: arena.id, restartDelaySeconds: gatewayConfig.replay.restartDelaySeconds },
        "replay finished — keeping final state visible before restart",
      );
      await trackWork(sleep(gatewayConfig.replay.restartDelaySeconds * 1_000, abortController.signal));
      if (abortController.signal.aborted) return;
      await shutdown("replay cycle complete");
      process.exitCode = REPLAY_CYCLE_EXIT_CODE;
    }
  } catch (err) {
    const interruptedBySignal = abortController.signal.aborted;
    await shutdown("runtime failure").catch(() => undefined);
    if (interruptedBySignal) return;
    throw err;
  }
}

function safeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, ...(err.stack !== undefined ? { stack: err.stack } : {}) };
  }
  return { name: "Error", message: String(err) };
}

async function listenHttpServer(httpServer: HttpServer, port: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      if (abortSignal.aborted) {
        void closeHttpServer(httpServer).then(resolve, reject);
      } else {
        resolve();
      }
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port);
  });
}

async function closeHttpServer(httpServer: HttpServer): Promise<void> {
  if (!httpServer.listening) return;
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

main().catch(async (err: unknown) => {
  logger.fatal({ error: safeError(err) }, "gateway failed to start");
  process.exitCode = 1;
});
