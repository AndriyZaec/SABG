// Gateway entrypoint. Run via `pnpm gateway:dev` (apps/api) or
// `pnpm --filter @arena/api gateway:dev`.
//
// Demo driver (scope decision): drives the real engine pipeline via `replayFixture` over a
// recorded fixture (default 18179764, the same one the engine test suites replay) — no
// Mongo/TxLINE credentials needed. Override which recorded match plays via
// GATEWAY_DEMO_FIXTURE_ID (see gateway/config.ts) — it must have a matching
// ingestion/__fixtures__/fixture-<id>.json. The live worker (src/live/run.ts) can drive the same
// ArenaRuntime later; the runtime itself is source-agnostic (just a MatchSignalBus consumer).
//
// Demo bootstrap is self-contained: it upserts its own match+arena keyed by `txoddsFixtureId`,
// independent of `db:seed` (whose matches.json seeds a *different* fixture, 18209181, than the
// replay uses — see match.repository.ts's doc comment).

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
async function replayFixturePaced(bus: MatchSignalBus, matchId: string, secondsPerMatchMinute: number): Promise<void> {
  const raw = loadFixture(fixturePathFor(DEMO_FIXTURE_ID));
  const producer = createMatchSignalProducer(matchId);
  let lastMinute: number | undefined;
  for (const message of raw) {
    for (const signal of producer.process(message)) {
      if (signal.kind === "clock") {
        const advanced = lastMinute === undefined ? 0 : Math.max(signal.matchMinute - lastMinute, 0);
        lastMinute = signal.matchMinute;
        if (advanced > 0) await sleep(advanced * secondsPerMatchMinute * 1000);
      }
      bus.publish(signal);
    }
  }
}

async function main(): Promise<void> {
  // Real names when the fixture is listed in db/seeds/matches.json — the scores feed itself
  // carries no team names, only "Home"/"Away" for a fixture that isn't seeded yet.
  const teams = resolveFixtureTeams(DEMO_FIXTURE_ID) ?? { homeTeam: "Home", awayTeam: "Away" };
  const match = await matchRepository.upsertByTxoddsFixtureId(DEMO_FIXTURE_ID, {
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    startTime: new Date(),
  });
  const arena = await arenaRepository.upsertForMatch(match.id, {
    entryFeeLamports: DEMO_ENTRY_FEE_LAMPORTS,
    prizePoolLamports: 0,
  });
  logger.info({ matchId: match.id, arenaId: arena.id, fixtureId: DEMO_FIXTURE_ID }, "demo match/arena ready");

  const { httpServer, wsGateway } = createGatewayServer();

  const writeQueue = new WriteQueue();
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
      void writeQueue.enqueue(arenaId, () => arenaRepository.setStatus(arenaId, "finished"));
      // Release the escrow to winners (no-op for off-chain arenas — see payout service).
      void payoutService.settleArena(arenaId, winners);
    },
  };

  const bus = new MatchSignalBus();

  // Bots answer each round via a broadcaster wrapper; `demoBots`/`runtime` are read through getters
  // to sidestep the runtime↔broadcaster construction cycle. Disabled → the raw WS broadcaster.
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
    // Roster starts empty — bots (below) and the human (POST /arenas/:id/entry) join pre-kickoff.
    roster: [],
    broadcaster,
    persistence,
    secondsPerMatchMinute: gatewayConfig.clock.secondsPerMatchMinute,
  });
  wsGateway.registerRuntime(arena.id, runtime);

  // Listen before the lobby window so bots and the browser can join while the arena is still `lobby`.
  await new Promise<void>((resolve) => httpServer.listen(gatewayConfig.port, resolve));
  logger.info({ port: gatewayConfig.port }, `gateway listening — REST http://localhost:${gatewayConfig.port}/api, WS ws://localhost:${gatewayConfig.port}/ws`);

  if (gatewayConfig.bots.enabled) {
    demoBots = await joinBots(arena.id, runtime, gatewayConfig.bots.count, DEMO_ENTRY_FEE_LAMPORTS);
    logger.info({ arenaId: arena.id, bots: demoBots.length }, "demo bots joined the lobby");
  }

  // Pre-kickoff lobby window: arena stays `lobby` so the human can buy in + join, then flips `live`.
  logger.info({ arenaId: arena.id, lobbySeconds: gatewayConfig.lobby.seconds }, "lobby open — waiting for players");
  await sleep(gatewayConfig.lobby.seconds * 1000);
  await arenaRepository.setStatus(arena.id, "live");
  logger.info({ arenaId: arena.id }, "kickoff — arena live");

  await replayFixturePaced(bus, match.id, gatewayConfig.clock.secondsPerMatchMinute);
  logger.info({ arenaId: arena.id }, "demo replay finished");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "gateway failed to start");
  process.exit(1);
});
