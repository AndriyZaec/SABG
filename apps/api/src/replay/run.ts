// Replay Engine headless demo entrypoint. Run via `pnpm replay:dev` (apps/api) or
// `pnpm --filter @arena/api replay:dev`.
//
// Drives the real engine pipeline (unchanged, via ArenaRuntime — the same source-agnostic
// composition root gateway/run.ts uses) with a scripted bot roster and a console broadcaster —
// no Postgres/WS server needed, so the whole game loop (kickoff -> winner) is provable with a
// single process and no external dependencies. Speed is configurable via REPLAY_SPEED (default
// 60x) so a full ~100 real-match-minute fixture finishes in seconds.

import type { Answer, ServerMessage, Uuid } from "@arena/contracts";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { FIXTURE_MATCH_ID } from "../ingestion/replay.js";
import { ArenaRuntime, type GatewayBroadcaster } from "../gateway/arena-runtime.js";
import { createInMemoryRuntimeStores } from "../gateway/stores/in-memory-stores.js";
import { ReplayEngine } from "./engine.js";
import { createBots, type BotPlayer } from "./bots.js";
import { replayConfig } from "./config.js";
import { logger } from "./logger.js";

/** Placeholder arena id for the headless demo — no real Arena row exists for it. */
const DEMO_ARENA_ID: Uuid = "00000000-0000-0000-0000-0000000b7000";

/** Logs every broadcast/personal message — the kickoff -> winner narrative on stdout. */
function createConsoleBroadcaster(): GatewayBroadcaster {
  return {
    broadcast(_arenaId, message: ServerMessage) {
      logger.info({ message }, `[broadcast] ${message.type}`);
    },
    sendToUser(_arenaId, userId, message: ServerMessage) {
      logger.info({ userId, message }, `[personal] ${message.type}`);
    },
  };
}

export interface ReplayDemoOptions {
  speed?: number;
  maxGapMs?: number;
  leadTimeSeconds?: number;
  botCount?: number;
  arenaId?: Uuid;
  matchId?: string;
  fixturePath?: string;
  broadcaster?: GatewayBroadcaster;
}

export interface ReplayDemo {
  runtime: ArenaRuntime;
  bus: MatchSignalBus;
  replayEngine: ReplayEngine;
  bots: BotPlayer[];
  /** Runs the paced replay to completion. */
  play(): Promise<void>;
}

/**
 * Wires one headless replay demo: bot roster + in-memory stores + `ArenaRuntime` (unchanged
 * pipeline) + a `ReplayEngine` driving it over the recorded fixture. Exported standalone (rather
 * than only reachable via `main()`) so `demo.test.ts` can drive it with a spy broadcaster and no
 * process, mirroring gateway/__tests__/arena-runtime.test.ts's pattern.
 */
export function createReplayDemo(options: ReplayDemoOptions = {}): ReplayDemo {
  const arenaId = options.arenaId ?? DEMO_ARENA_ID;
  const matchId = options.matchId ?? FIXTURE_MATCH_ID;
  const bots = createBots(options.botCount ?? replayConfig.botCount);
  const botIds = bots.map((b) => b.userId);

  const bus = new MatchSignalBus();
  const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(arenaId, botIds);
  const outerBroadcaster = options.broadcaster ?? createConsoleBroadcaster();

  let runtime!: ArenaRuntime; // assigned below, before any signal on `bus` can fire
  const answeringBroadcaster: GatewayBroadcaster = {
    ...outerBroadcaster,
    broadcast(broadcastArenaId, message) {
      outerBroadcaster.broadcast(broadcastArenaId, message);
      if (message.type !== "round.open") return;
      // Every still-active bot answers immediately on open — lands well before the feed-driven
      // lock (spec §5: rounds open >=60s of lead time before lock).
      const round = message.round;
      for (const bot of bots) {
        if (arenaPlayerStore.getStatus(bot.userId) !== "active") continue;
        const answer: Answer = bot.answerFor(round);
        runtime.submitAnswer(bot.userId, round.id, answer);
      }
    },
  };

  const leadTimeSeconds = options.leadTimeSeconds ?? replayConfig.leadTimeSeconds;
  const fixturePath = options.fixturePath;

  runtime = new ArenaRuntime({
    matchId,
    arenaId,
    bus,
    predictionStore,
    arenaPlayerStore,
    roster: bots.map((b) => ({ userId: b.userId, username: b.username, joinedAt: b.joinedAt })),
    broadcaster: answeringBroadcaster,
    // No persistence — kept DB-free, mirroring arena-runtime.test.ts.
    ...(leadTimeSeconds !== undefined ? { leadTimeSeconds } : {}),
  });

  const replayEngine = new ReplayEngine(bus, {
    matchId,
    speed: options.speed ?? replayConfig.speed,
    maxGapMs: options.maxGapMs ?? replayConfig.maxGapMs,
    ...(fixturePath !== undefined ? { fixturePath } : {}),
  });

  return { runtime, bus, replayEngine, bots, play: () => replayEngine.play() };
}

async function main(): Promise<void> {
  const demo = createReplayDemo();
  logger.info(
    { speed: replayConfig.speed, maxGapMs: replayConfig.maxGapMs, bots: demo.bots.length },
    "starting headless replay demo",
  );

  await demo.play();

  const winners = demo.runtime.finalWinners();
  logger.info({ winners, matchState: demo.runtime.matchState }, "replay demo finished");
}

// Only auto-run when executed directly (`tsx src/replay/run.ts`) — importing `createReplayDemo`
// from a test must not trigger a full replay as a side effect of the import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, "replay demo failed");
    process.exit(1);
  });
}
