import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { createMatchSignalProducer } from "../ingestion/match-signal.js";
import { fixturePathFor, loadFixture } from "../ingestion/replay.js";
import { resolveFixtureTeams } from "../db/seeds/fixture-metadata.js";
import { sleep } from "../shared/sleep.js";
import { discoverWorldCupFixture } from "../live/fixture-discovery.js";

export type GameSourceKind = "replay" | "live";

export interface GameSourceFixture {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  startTime: Date;
}

export interface GameSourceContext {
  bus: MatchSignalBus;
  matchId: string;
  signal: AbortSignal;
}

export interface GameSource {
  kind: GameSourceKind;
  label: string;
  fixture: GameSourceFixture;
  prepare(context: GameSourceContext): Promise<void>;
  run(context: GameSourceContext): Promise<void>;
  stop(): Promise<void>;
}

export interface GameSourceOptions {
  kind: GameSourceKind;
  replayFixtureId: number;
  secondsPerMatchMinute: number;
  liveFixtureId?: number;
  signal: AbortSignal;
}

export function calculateLobbyDurationMs(
  source: GameSourceKind,
  fixtureStartTime: Date,
  configuredReplayLobbyMs: number,
  nowMs = Date.now(),
): number {
  return source === "live"
    ? Math.max(0, fixtureStartTime.getTime() - nowMs)
    : configuredReplayLobbyMs;
}

export async function createGameSource(options: GameSourceOptions): Promise<GameSource> {
  if (options.kind === "replay") {
    return createReplaySource(options.replayFixtureId, options.secondsPerMatchMinute);
  }
  return createLiveSource(options.liveFixtureId, options.signal);
}

function createReplaySource(fixtureId: number, secondsPerMatchMinute: number): GameSource {
  const teams = resolveFixtureTeams(fixtureId) ?? { homeTeam: "Home", awayTeam: "Away" };
  const raw = loadFixture(fixturePathFor(fixtureId));

  return {
    kind: "replay",
    label: "RECORDED REPLAY",
    fixture: { fixtureId, ...teams, startTime: new Date() },
    async prepare() {},
    async run({ bus, matchId, signal }) {
      const producer = createMatchSignalProducer(matchId);
      let lastMinute: number | undefined;
      for (const message of raw) {
        if (signal.aborted) return;
        for (const matchSignal of producer.process(message)) {
          if (matchSignal.kind === "clock") {
            const advanced = lastMinute === undefined ? 0 : Math.max(matchSignal.matchMinute - lastMinute, 0);
            lastMinute = matchSignal.matchMinute;
            if (advanced > 0) await sleep(advanced * secondsPerMatchMinute * 1_000, signal);
          }
          if (signal.aborted) return;
          bus.publish(matchSignal);
        }
      }
    },
    async stop() {},
  };
}

async function createLiveSource(fixtureId: number | undefined, signal: AbortSignal): Promise<GameSource> {
  const [
    { LiveIngestionWorker },
    { MongoService },
    { ensureIndexes },
    { GuestJwtService },
    { TxLineService },
  ] =
    await Promise.all([
      import("../live/worker.js"),
      import("../live/mongo/mongo.service.js"),
      import("../live/mongo/ensure-indexes.js"),
      import("../live/auth/guest-jwt.service.js"),
      import("../live/auth/txline.service.js"),
    ]);

  let worker: InstanceType<typeof LiveIngestionWorker> | undefined;
  try {
    await MongoService.getDb();
    await ensureIndexes();
    await GuestJwtService.getInstance().getJwt();
    await TxLineService.getInstance().getApiToken();
    const discovered = await discoverWorldCupFixture({ ...(fixtureId !== undefined ? { fixtureId } : {}) });
    if (signal.aborted) throw new Error("Live source setup aborted");

    return {
      kind: "live",
      label: "LIVE FEED",
      fixture: {
        fixtureId: discovered.fixtureId,
        homeTeam: discovered.homeTeam,
        awayTeam: discovered.awayTeam,
        startTime: new Date(discovered.startTime),
      },
      async prepare({ bus, matchId }) {
        worker = new LiveIngestionWorker(matchId, bus);
        await worker.start(discovered.fixtureId);
        await worker.waitUntilReady(45_000);
      },
      async run() {
        if (worker === undefined) throw new Error("Live source must be prepared before it can run");
        worker.activate();
        await worker.waitUntilStopped();
      },
      async stop() {
        worker?.shutdown();
        await worker?.waitUntilStopped();
        await MongoService.quit();
      },
    };
  } catch (err) {
    worker?.shutdown();
    await MongoService.quit().catch(() => undefined);
    throw err;
  }
}
