// Live GRID poll loop: one raw seriesState response, fanned out to both CS2 parsers every
// ~10s (spec §9's polling cadence). Structurally mirrors grid/recorder.ts's runLoop (try/catch,
// shared backoff, sleep-based scheduling — no timers/cron, per series-lifecycle.ts's own "why
// this needs no scheduler" note) but replaces the WAITING_FOR_START/RECORDING state machine with
// two independent, already-pure consumers:
//
//   observeSnapshot (per-map)  -> trackCs2Poll -> Cs2MatchSignal[] -> target.currentBus()
//   parseSeriesSnapshot (series-level)          -> target.poll(snapshot, now)
//
// Ordering within one poll is load-bearing: `currentBus()` is read *before* `target.poll()` runs.
// Both parsers watch the same underlying `games` field, so a map ending (games -> []) and the
// series-level Match-ended edge fire on the *same* poll. `target.poll()` may reactively open the
// next Arena in that same call — if it ran first, the per-map cs2_match_end signal (still meant
// for the map that just ended) would land on the wrong (not-yet-live) Arena's bus instead.
//
// Depends only on the minimal `Cs2LivePollerTarget` shape, not the concrete
// `Cs2SeriesOrchestrator` — lets this run fully in-memory in tests (no Postgres), while the real
// orchestrator's own behavior stays covered by series-orchestrator.int.test.ts.

import type { IsoDateTime } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { sleep } from "../shared/sleep.js";
import { nextBackoffMs } from "../grid/backoff.js";
import { logger } from "../grid/logger.js";
import { observeSnapshot } from "./snapshot.js";
import { initialCs2TrackerState, trackCs2Poll, type Cs2TrackerState } from "./round-tracker.js";
import { parseSeriesSnapshot, type Cs2SeriesSnapshot } from "./series-snapshot.js";
import type { Cs2RawPollResult } from "./raw-recorder.js";

export interface Cs2LivePollerTarget {
  poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void>;
  currentBus(): MatchSignalBus | undefined;
}

/** Narrower than Cs2RawRecorder — lets tests fake raw recording without a real Mongo-backed one. */
export interface Cs2RawRecorderTarget {
  handlePoll(result: Cs2RawPollResult): Promise<void>;
}

export interface Cs2LivePollerOptions {
  target: Cs2LivePollerTarget;
  /**
   * Superset of GridClient.fetchSeriesState's return shape — `status`/`headers` are only read by
   * `rawRecorder` (optional), the fan-out logic itself still only reads `data`.
   */
  fetchSeriesState: (signal?: AbortSignal) => Promise<Cs2RawPollResult>;
  pollIntervalMs: number;
  /** Best-effort raw-poll recording (cs2/raw-recorder.ts) — omitted when CS2_RAW_RECORDING_ENABLED is off. */
  rawRecorder?: Cs2RawRecorderTarget;
}

/**
 * One poll's worth of fan-out (see file header for why the ordering matters) — extracted out of
 * `Cs2LivePoller`'s timer loop so it's directly unit-testable without fake timers or a real
 * fetch/backoff cycle around it.
 */
export async function handleCs2LivePoll(
  target: Cs2LivePollerTarget,
  raw: unknown,
  trackerState: Cs2TrackerState,
  now: IsoDateTime,
): Promise<Cs2TrackerState> {
  // Per-map first, on the *current* Arena's bus — before target.poll() can reactively open the
  // next one (see file header).
  const observation = observeSnapshot(raw);
  const seriesSnapshot = parseSeriesSnapshot(raw);
  if (observation.kind === "invalid" || seriesSnapshot === undefined) return trackerState;

  const bus = target.currentBus();
  const tracked = trackCs2Poll(trackerState, observation.kind === "live" ? observation.snapshot : undefined, now);
  if (bus !== undefined) {
    for (const signal of tracked.signals) bus.publish(signal);
  }

  await target.poll(seriesSnapshot, now);

  return tracked.state;
}

export class Cs2LivePoller {
  private running = false;
  private stopController: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;
  private errorStreak = 0;
  private trackerState: Cs2TrackerState = initialCs2TrackerState();

  constructor(private readonly options: Cs2LivePollerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopController = new AbortController();
    this.loopPromise = this.runLoop(this.stopController.signal);
  }

  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.stopController?.abort();
    await this.loopPromise;
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (this.running) {
      try {
        const result = await this.options.fetchSeriesState(signal);
        const now: IsoDateTime = new Date().toISOString();
        this.trackerState = await handleCs2LivePoll(this.options.target, result.data, this.trackerState, now);
        this.errorStreak = 0;

        // Best-effort: a raw-recording failure must never be treated as a poll failure (it would
        // otherwise trigger the same backoff/error-streak handling as a real GRID fetch error).
        if (this.options.rawRecorder !== undefined) {
          try {
            await this.options.rawRecorder.handlePoll(result);
          } catch (err) {
            logger.warn({ err }, "cs2: raw recorder threw — ignoring");
          }
        }
      } catch (err) {
        logger.error({ err }, "cs2: poll failed");
        this.errorStreak += 1;
        await sleep(nextBackoffMs(this.errorStreak), signal);
        continue;
      }
      await sleep(this.options.pollIntervalMs, signal);
    }
  }
}
