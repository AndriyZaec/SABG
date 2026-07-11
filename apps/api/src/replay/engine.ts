// Replay Engine: paces the recorded TxODDS fixture onto the bus with configurable ×N speed, so a
// full match can be demoed kickoff -> winner without a live feed. Reuses the existing normalizer
// (`createMatchSignalProducer`) and fixture loader (`ingestion/replay.ts`) unchanged — this
// module only adds pacing on top of the existing synchronous `replayFixture`.
//
// The match clock is derived purely from feed pacing (ingestion/match-signal.ts's `clock`
// signals) — no engine anywhere uses a wall-clock timer (see round-engine/engine.ts's doc comment
// on why its `lockAt` estimate is non-authoritative). So "×N speed" is entirely a matter of how
// fast raw fixture messages are fed onto the bus; no engine needs rescaling.

import type { MatchSignal } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { loadFixture, defaultFixturePath, FIXTURE_MATCH_ID } from "../ingestion/replay.js";
import { createMatchSignalProducer } from "../ingestion/match-signal.js";
import { sleep } from "../shared/sleep.js";

/**
 * Real wait time for one inter-message gap: scales the fixture's own `Ts` delta by `speed`, but
 * clamped to `maxGapMs` first so idle stretches (pre-kickoff, halftime) collapse instead of
 * dominating the replay. Negative deltas (out-of-order `Ts`, shouldn't happen but defensive) are
 * treated as zero. Exported standalone so the pacing math is unit-testable without a fixture.
 */
export function computeWaitMs(rawGapMs: number, maxGapMs: number, speed: number): number {
  const clamped = Math.min(Math.max(rawGapMs, 0), maxGapMs);
  return clamped / speed;
}

export interface ReplayEngineOptions {
  /** Playback speed multiplier — ×1 is authentic real-time, higher is faster. Must be > 0. */
  speed?: number;
  matchId?: string;
  fixturePath?: string;
  /** Clamp on any single inter-message wait, in real (pre-speed) ms — bounds idle gaps. */
  maxGapMs?: number;
  /** Called after each message is processed, with its emitted signals (already published). */
  onSignal?: (signal: MatchSignal, index: number) => void;
}

const DEFAULT_SPEED = 1;
const DEFAULT_MAX_GAP_MS = 2_000;

/**
 * Replays a recorded fixture onto `bus`, pacing inter-message gaps by the fixture's own `Ts`
 * timestamps scaled by `speed` (see `computeWaitMs`). `speed` very high (or `maxGapMs: 0`)
 * degenerates to the same 0-delay behaviour as `ingestion/replay.ts`'s `replayFixture`.
 */
export class ReplayEngine {
  private readonly speed: number;
  private readonly matchId: string;
  private readonly fixturePath: string;
  private readonly maxGapMs: number;
  private readonly onSignal: ReplayEngineOptions["onSignal"];
  private stopped = false;

  constructor(
    private readonly bus: MatchSignalBus,
    options: ReplayEngineOptions = {},
  ) {
    this.speed = options.speed ?? DEFAULT_SPEED;
    if (this.speed <= 0) throw new Error(`ReplayEngine speed must be > 0, got ${this.speed}`);
    this.matchId = options.matchId ?? FIXTURE_MATCH_ID;
    this.fixturePath = options.fixturePath ?? defaultFixturePath();
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.onSignal = options.onSignal;
  }

  /** Stops the replay after the current in-flight wait/message — safe to call from a callback. */
  stop(): void {
    this.stopped = true;
  }

  /** Runs the paced replay to completion (or until `stop()`). Resolves once done. */
  async play(): Promise<void> {
    const raw = loadFixture(this.fixturePath);
    const producer = createMatchSignalProducer(this.matchId);

    let lastTs: number | undefined;
    for (let i = 0; i < raw.length; i++) {
      if (this.stopped) return;

      const message = raw[i]!;
      if (lastTs !== undefined && message.Ts !== undefined) {
        const wait = computeWaitMs(message.Ts - lastTs, this.maxGapMs, this.speed);
        if (wait > 0) await sleep(wait);
      }
      if (message.Ts !== undefined) lastTs = message.Ts;

      if (this.stopped) return;

      for (const signal of producer.process(message)) {
        this.bus.publish(signal);
        this.onSignal?.(signal, i);
      }
    }
  }
}
