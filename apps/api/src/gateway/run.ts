// Gateway entrypoint. Run via `pnpm gateway:dev` (apps/api) or
// `pnpm --filter @arena/api gateway:dev`.
//
// Demo driver (scope decision): drives the real engine pipeline via `replayFixture` over a
// recorded fixture (default 18241006, England v Argentina) — no Mongo/TxLINE credentials
// needed. Override which recorded match plays via
// GATEWAY_DEMO_FIXTURE_ID (see gateway/config.ts) — it must have a matching
// ingestion/__fixtures__/fixture-<id>.json. The live worker (src/live/run.ts) can drive the same
// ArenaRuntime later; the runtime itself is source-agnostic (just a MatchSignalBus consumer).
//
// Demo bootstrap is self-contained: it upserts its own match+arena keyed by `txoddsFixtureId`,
// independent of `db:seed` (whose matches.json seeds a *different* fixture, 18209181, than the
// replay uses — see match.repository.ts's doc comment).

import type { Server as HttpServer } from "node:http";
import { loadFixture, fixturePathFor } from "../ingestion/replay.js";
import { createMatchSignalProducer } from "../ingestion/match-signal.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { resolveFixtureTeams } from "../db/seeds/fixture-metadata.js";
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
import { joinBots, withBotAnswers, type DemoBot } from "./demo-bots.js";
import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client.js";

/** Which recorded fixture the demo replay drives — see GATEWAY_DEMO_FIXTURE_ID (gateway/config.ts). */
const DEMO_FIXTURE_ID = gatewayConfig.demo.fixtureId;
const DEMO_ENTRY_FEE_LAMPORTS = 10_000_000;

/**
 * Like `replayFixture` (ingestion/replay.ts), but paced by the match clock: each time a clock
 * signal advances the match minute, we sleep `secondsPerMatchMinute` real seconds per minute
 * advanced before publishing it, so the match plays out at a controlled, watchable rate. Non-clock
 * signals (events, possession) and same-minute messages publish with no extra wait. Pacing by
 * match-minute — not per raw message — is what keeps the countdown honest: the round engine
 * projects `lockAt` off the same rate, so a round's shown countdown matches when it actually locks.
 */
async function replayFixturePaced(
  bus: MatchSignalBus,
  matchId: string,
  secondsPerMatchMinute: number,
  abortSignal: AbortSignal,
): Promise<void> {
  const raw = loadFixture(fixturePathFor(DEMO_FIXTURE_ID));
  const producer = createMatchSignalProducer(matchId);
  let lastMinute: number | undefined;
  for (const message of raw) {
    if (abortSignal.aborted) return;
    for (const matchSignal of producer.process(message)) {
      if (matchSignal.kind === "clock") {
        const advanced = lastMinute === undefined ? 0 : Math.max(matchSignal.matchMinute - lastMinute, 0);
        lastMinute = matchSignal.matchMinute;
        if (advanced > 0) await sleep(advanced * secondsPerMatchMinute * 1000, abortSignal);
      }
      if (abortSignal.aborted) return;
      bus.publish(matchSignal);
    }
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController();
  const writeQueue = new WriteQueue();
  let gatewayServer: ReturnType<typeof createGatewayServer> | undefined;
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
      await activeWork.catch(() => undefined);
      await wsClosing;
      await httpClosing;
      await writeQueue.drain();
      await closeDatabaseConnection();
      logger.info({ signal }, "gateway shutdown complete");
    })();
    return shutdownPromise;
  };
  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((err: unknown) => {
      logger.error({ err, signal }, "gateway shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
  process.once("SIGINT", () => handleSignal("SIGINT"));

  try {
    await trackWork(checkDatabaseConnection());
    if (abortController.signal.aborted) return;

    // Real names when the fixture is listed in db/seeds/matches.json — the scores feed itself
    // carries no team names, only "Home"/"Away" for a fixture that isn't seeded yet.
    const teams = resolveFixtureTeams(DEMO_FIXTURE_ID) ?? { homeTeam: "Home", awayTeam: "Away" };
    const match = await trackWork(
      matchRepository.upsertByTxoddsFixtureId(DEMO_FIXTURE_ID, {
        homeTeam: teams.homeTeam,
        awayTeam: teams.awayTeam,
        startTime: new Date(),
      }),
    );
    if (abortController.signal.aborted) return;
    const arena = await trackWork(
      arenaRepository.upsertForMatch(match.id, {
        entryFeeLamports: DEMO_ENTRY_FEE_LAMPORTS,
        prizePoolLamports: 0,
      }),
    );
    if (abortController.signal.aborted) return;
    logger.info({ matchId: match.id, arenaId: arena.id, fixtureId: DEMO_FIXTURE_ID }, "demo match/arena ready");

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
    let demoBots: DemoBot[] = [];
    let runtime!: ArenaRuntime;
    const broadcaster = gatewayConfig.bots.enabled
      ? withBotAnswers(wsGateway, {
          getBots: () => demoBots,
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
      secondsPerMatchMinute: gatewayConfig.clock.secondsPerMatchMinute,
      teamNames: { home: match.homeTeam, away: match.awayTeam },
    });
    wsGateway.registerRuntime(arena.id, runtime);

    // Listen before the lobby window so bots and the browser can join while the arena is still `lobby`.
    await trackWork(listenHttpServer(httpServer, gatewayConfig.port, abortController.signal));
    if (abortController.signal.aborted) return;
    logger.info({ port: gatewayConfig.port }, `gateway listening — REST http://localhost:${gatewayConfig.port}/api, WS ws://localhost:${gatewayConfig.port}/ws`);

    if (gatewayConfig.bots.enabled) {
      demoBots = await trackWork(joinBots(arena.id, runtime, gatewayConfig.bots.count, DEMO_ENTRY_FEE_LAMPORTS));
      if (abortController.signal.aborted) return;
      logger.info({ arenaId: arena.id, bots: demoBots.length }, "demo bots joined the lobby");
    }

    // Pre-kickoff lobby window: arena stays `lobby` so the human can buy in + join, then flips `live`.
    logger.info({ arenaId: arena.id, lobbySeconds: gatewayConfig.lobby.seconds }, "lobby open — waiting for players");
    await trackWork(sleep(gatewayConfig.lobby.seconds * 1000, abortController.signal));
    if (abortController.signal.aborted) return;
    await trackWork(arenaRepository.setStatus(arena.id, "live"));
    if (abortController.signal.aborted) return;
    logger.info({ arenaId: arena.id }, "kickoff — arena live");

    await trackWork(replayFixturePaced(bus, match.id, gatewayConfig.clock.secondsPerMatchMinute, abortController.signal));
    if (abortController.signal.aborted) return;
    logger.info({ arenaId: arena.id }, "demo replay finished");
  } catch (err) {
    await shutdown("runtime failure").catch(() => undefined);
    throw err;
  }
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
  logger.fatal({ err }, "gateway failed to start");
  process.exitCode = 1;
});
