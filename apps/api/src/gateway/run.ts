// Gateway entrypoint. Run via `pnpm gateway:dev` (apps/api) or
// `pnpm --filter @arena/api gateway:dev`.
//
// Demo driver (scope decision): drives the real engine pipeline via `replayFixture` over the same
// recorded fixture (18179764) the engine test suites already use — no Mongo/TxLINE credentials
// needed. The live worker (src/live/run.ts) can drive the same ArenaRuntime later; the runtime
// itself is source-agnostic (just a MatchSignalBus consumer).
//
// Demo bootstrap is self-contained: it upserts its own match+arena keyed by `txoddsFixtureId`,
// independent of `db:seed` (whose matches.json seeds a *different* fixture, 18209181, than the
// replay uses — see match.repository.ts's doc comment).

import { loadFixture, defaultFixturePath } from "../ingestion/replay.js";
import { createMatchSignalProducer } from "../ingestion/match-signal.js";
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

/** Same recorded fixture the engine test suites replay — see ingestion/replay.ts. */
const DEMO_FIXTURE_ID = 18179764;
const DEMO_ENTRY_FEE_LAMPORTS = 10_000_000;

/**
 * Like `replayFixture` (ingestion/replay.ts), but spread over wall-clock time via `delayMs`
 * between messages — reuses the same helpers (`loadFixture`, `createMatchSignalProducer`) rather
 * than duplicating their logic, just with an async pacing loop instead of a tight synchronous
 * one, so a manual WS walkthrough is actually watchable.
 */
async function replayFixturePaced(bus: MatchSignalBus, matchId: string, delayMs: number): Promise<void> {
  const raw = loadFixture(defaultFixturePath());
  const producer = createMatchSignalProducer(matchId);
  for (const message of raw) {
    for (const signal of producer.process(message)) bus.publish(signal);
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function main(): Promise<void> {
  const match = await matchRepository.upsertByTxoddsFixtureId(DEMO_FIXTURE_ID, {
    homeTeam: "Home",
    awayTeam: "Away",
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
  const runtime = new ArenaRuntime({
    matchId: match.id,
    arenaId: arena.id,
    bus,
    predictionStore,
    arenaPlayerStore,
    // Real players join dynamically via POST /arenas/:id/entry (spec §9) — no scripted roster.
    roster: [],
    broadcaster: wsGateway,
    persistence,
    ...(gatewayConfig.replay.leadTimeSeconds !== undefined
      ? { leadTimeSeconds: gatewayConfig.replay.leadTimeSeconds }
      : {}),
  });
  wsGateway.registerRuntime(arena.id, runtime);

  // Join is only valid pre-kickoff (spec §9) — flip to "live" now, right before kickoff starts.
  await arenaRepository.setStatus(arena.id, "live");

  await new Promise<void>((resolve) => httpServer.listen(gatewayConfig.port, resolve));
  logger.info({ port: gatewayConfig.port }, `gateway listening — REST http://localhost:${gatewayConfig.port}/api, WS ws://localhost:${gatewayConfig.port}/ws`);

  await replayFixturePaced(bus, match.id, gatewayConfig.replay.delayMs);
  logger.info({ arenaId: arena.id }, "demo replay finished");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "gateway failed to start");
  process.exit(1);
});
