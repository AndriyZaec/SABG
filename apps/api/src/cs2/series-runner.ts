import type { IsoDateTime } from "@arena/contracts";
import { tryAcquireSeriesRuntimeLock, type ReleaseDatabaseLock } from "../db/client.js";
import { cs2IdentityRepository } from "../db/repositories/cs2-identity.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import type { GatewayWebSocketServer } from "../gateway/ws.js";
import type { WriteQueue } from "../gateway/stores/write-queue.js";
import { nextBackoffMs } from "../grid/backoff.js";
import { gridConfig } from "../grid/config/env.js";
import { GridClient, type GridFetchResult } from "../grid/grid-client.js";
import { logger } from "../grid/logger.js";
import { sleep } from "../shared/sleep.js";
import { Cs2LivePoller } from "./live-poller.js";
import { Cs2RawRecorder } from "./raw-recorder.js";
import { decideSeriesEntry } from "./series-entry.js";
import { Cs2SeriesOrchestrator, Cs2SeriesOvertakenError } from "./series-orchestrator.js";
import { parseGridSeriesSnapshot, type GridCs2SeriesSnapshot } from "./series-snapshot.js";
import { buildCs2TeamIdentityMap } from "./team-identity.js";

export interface Cs2SeriesGridClient {
  fetchSeriesState(gridSeriesId: string, signal?: AbortSignal): Promise<GridFetchResult>;
}

export interface Cs2SeriesRunnerStartOptions {
  gridSeriesId: string;
  scheduledStartTime: IsoDateTime;
  wsGateway: GatewayWebSocketServer;
  writeQueue: WriteQueue;
  entryFeeLamports: number;
  rawRecordingEnabled: boolean;
  signal: AbortSignal;
  gridClient?: Cs2SeriesGridClient;
  /** Give up priming at this time and skip the series (the autopilot); without it, priming retries until aborted. */
  primingDeadline?: IsoDateTime;
  /**
   * Called from the poll loop once the series is over (`complete`) or can't be followed (`overtaken`).
   * Must not await `stop()`: the poll that reports it is still running.
   */
  onEnd?: (outcome: "complete" | "overtaken") => void;
}

export type Cs2SeriesRunnerStartResult =
  | { kind: "started"; runner: Cs2SeriesRunner }
  | { kind: "skipped"; reason: string }
  | { kind: "aborted" };

async function primeSeries(
  client: Cs2SeriesGridClient,
  gridSeriesId: string,
  signal: AbortSignal,
  deadline: IsoDateTime | undefined,
): Promise<GridCs2SeriesSnapshot | undefined> {
  let errorStreak = 0;
  while (!signal.aborted && (deadline === undefined || Date.now() < Date.parse(deadline))) {
    try {
      const result = await client.fetchSeriesState(gridSeriesId, signal);
      const snapshot = parseGridSeriesSnapshot(result.data);
      if (snapshot?.format !== undefined) return snapshot;
      logger.warn({ gridSeriesId }, "cs2: priming poll had no parseable Series format yet — retrying");
      errorStreak = 0;
    } catch (err) {
      logger.error({ err, gridSeriesId }, "cs2: priming poll failed");
      errorStreak += 1;
    }
    const delay = errorStreak > 0 ? nextBackoffMs(errorStreak) : gridConfig.grid.pollIntervalMs;
    await sleep(deadline === undefined ? delay : Math.max(0, Math.min(delay, Date.parse(deadline) - Date.now())), signal);
  }
  return undefined;
}

/** Runs one CS2 series from priming to its end, under the per-series advisory lock. */
export class Cs2SeriesRunner {
  private stopPromise: Promise<void> | undefined;

  private constructor(
    readonly seriesId: string,
    readonly gridSeriesId: string,
    private readonly orchestrator: Cs2SeriesOrchestrator,
    private readonly poller: Cs2LivePoller,
    private readonly writeQueue: WriteQueue,
    private readonly releaseLock: ReleaseDatabaseLock,
  ) {}

  static async start(options: Cs2SeriesRunnerStartOptions): Promise<Cs2SeriesRunnerStartResult> {
    const { gridSeriesId, signal } = options;
    const releaseLock = await tryAcquireSeriesRuntimeLock(gridSeriesId);
    if (!releaseLock) throw new Error(`Series ${gridSeriesId} already has an active CS2 live poller`);

    let handedOff = false;
    try {
      const client = options.gridClient ?? new GridClient();
      const primed = await primeSeries(client, gridSeriesId, signal, options.primingDeadline);
      if (signal.aborted) return { kind: "aborted" };
      if (primed?.format === undefined) {
        // Past the deadline: GRID never gave a usable state, e.g. it deleted or cancelled the series.
        const known = await seriesRepository.findByGridSeriesId(gridSeriesId);
        if (known !== undefined) await seriesRepository.setStatus(known.id, "skipped");
        logger.warn({ gridSeriesId }, "cs2: series skipped, no series state before the priming deadline");
        return { kind: "skipped", reason: "no_series_state" };
      }

      const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
        format: primed.format,
        scheduledStartTime: new Date(options.scheduledStartTime),
      });
      const persistedTeams = await cs2IdentityRepository.synchronizeSeriesTeams(series.id, primed.teams);
      const teamIdentities = buildCs2TeamIdentityMap(persistedTeams);

      // The 0:0 rule applies only to a first launch. A resume must let restore() rebuild or crash-close its arena.
      let startAfterMap1 = false;
      const firstLaunch = (await matchRepository.listBySeriesId(series.id)).length === 0;
      if (firstLaunch) {
        const entry = decideSeriesEntry(primed);
        if (entry.kind === "skip") {
          await seriesRepository.setStatus(series.id, "skipped");
          logger.info({ gridSeriesId, reason: entry.reason }, "cs2: series skipped on priming");
          return { kind: "skipped", reason: entry.reason };
        }
        startAfterMap1 = entry.kind === "enter_after_map_1";
      }
      logger.info({ seriesId: series.id, gridSeriesId, format: primed.format, startAfterMap1 }, "cs2: series ready");

      const { wsGateway } = options;
      const orchestrator = await Cs2SeriesOrchestrator.create(series, {
        writeQueue: options.writeQueue,
        entryFeeLamports: options.entryFeeLamports,
        broadcaster: wsGateway,
        onArenaOpened: (arenaId, runtime) => wsGateway.registerRuntime(arenaId, runtime),
        ...(startAfterMap1 ? { startAfterMap1: true as const } : {}),
      });
      if (signal.aborted) return { kind: "aborted" };

      let rawRecorder: Cs2RawRecorder | undefined;
      if (options.rawRecordingEnabled) {
        if (gridConfig.mongo.uri === undefined) {
          logger.warn("cs2: CS2_RAW_RECORDING_ENABLED is true but MONGODB_URI is unset — running without raw recording");
        } else {
          rawRecorder = new Cs2RawRecorder(gridSeriesId);
        }
      }

      let ended = false;
      const end = (outcome: "complete" | "overtaken") => {
        if (ended) return;
        ended = true;
        options.onEnd?.(outcome);
      };
      const poller = new Cs2LivePoller({
        target: {
          currentBus: () => orchestrator.currentBus(),
          updateLiveScore: (snapshot) => orchestrator.updateLiveScore(snapshot),
          poll: async (snapshot, now) => {
            try {
              await orchestrator.poll(snapshot, now);
            } catch (err) {
              if (err instanceof Cs2SeriesOvertakenError) end("overtaken");
              throw err;
            }
            if (options.onEnd !== undefined && (await orchestrator.isComplete())) end("complete");
          },
        },
        fetchSeriesState: (pollSignal) => client.fetchSeriesState(gridSeriesId, pollSignal),
        pollIntervalMs: gridConfig.grid.pollIntervalMs,
        teamIdentities,
        rawRecorder,
      });
      poller.start();
      logger.info({ gridSeriesId }, "cs2: live poller started");
      handedOff = true;
      return {
        kind: "started",
        runner: new Cs2SeriesRunner(series.id, gridSeriesId, orchestrator, poller, options.writeQueue, releaseLock),
      };
    } finally {
      if (!handedOff) await releaseLock();
    }
  }

  openedArenaIds(): string[] {
    return this.orchestrator.openedArenaIds();
  }

  /** Operator stop. Polling pauses so no poll races the skip, and resumes if it was refused. */
  async skip(): Promise<"skipped" | "refused"> {
    await this.poller.shutdown();
    let result: "skipped" | "refused" | undefined;
    try {
      result = await this.orchestrator.skip();
      return result;
    } finally {
      // Refused or failed (e.g. the on-chain cancel threw): keep following the series; the flag retries a failure.
      if (result !== "skipped") this.poller.start();
    }
  }

  /** Stops GRID polling only; call `stop()` once nothing else can write to the series' arenas. */
  stopPolling(): Promise<void> {
    return this.poller.shutdown();
  }

  stop(): Promise<void> {
    this.stopPromise ??= (async () => {
      try {
        await this.poller.shutdown();
        await this.writeQueue.drain();
      } finally {
        await this.releaseLock();
      }
    })();
    return this.stopPromise;
  }
}
