// Per-map signals must reach the current arena before series polling can open the next arena.

import type { Cs2GameSnapshot, IsoDateTime } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { sleep } from "../shared/sleep.js";
import { nextBackoffMs } from "../grid/backoff.js";
import { logger } from "../grid/logger.js";
import { observeSnapshot } from "./snapshot.js";
import { initialCs2TrackerState, trackCs2Poll, type Cs2TrackerState } from "./round-tracker.js";
import { parseSeriesSnapshot, type Cs2SeriesSnapshot } from "./series-snapshot.js";
import type { Cs2RawPollResult } from "./raw-recorder.js";
import type { Cs2TeamIdentityMap } from "./team-identity.js";

export interface Cs2LivePollerTarget {
  poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void>;
  currentBus(): MatchSignalBus | undefined;
  updateLiveScore(snapshot: Cs2GameSnapshot): Promise<void>;
}

export interface Cs2RawRecorderTarget {
  handlePoll(result: Cs2RawPollResult): Promise<void>;
}

export interface Cs2LivePollerOptions {
  target: Cs2LivePollerTarget;
  fetchSeriesState: (signal?: AbortSignal) => Promise<Cs2RawPollResult>;
  pollIntervalMs: number;
  teamIdentities: Cs2TeamIdentityMap;
  rawRecorder?: Cs2RawRecorderTarget;
}

export async function handleCs2LivePoll(
  target: Cs2LivePollerTarget,
  raw: unknown,
  trackerState: Cs2TrackerState,
  now: IsoDateTime,
  teamIdentities: Cs2TeamIdentityMap,
): Promise<Cs2TrackerState> {
  const observation = observeSnapshot(raw, teamIdentities);
  const seriesSnapshot = parseSeriesSnapshot(raw, teamIdentities);
  if (observation.kind === "invalid" || seriesSnapshot === undefined) return trackerState;

  const bus = target.currentBus();
  const tracked = trackCs2Poll(trackerState, observation.kind === "live" ? observation.snapshot : undefined, now);
  if (bus !== undefined) {
    for (const signal of tracked.signals) bus.publish(signal);
  }
  if (observation.kind === "live") await target.updateLiveScore(observation.snapshot);

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
        this.trackerState = await handleCs2LivePoll(
          this.options.target,
          result.data,
          this.trackerState,
          now,
          this.options.teamIdentities,
        );
        this.errorStreak = 0;

        // Recording failures must not trigger feed backoff.
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
