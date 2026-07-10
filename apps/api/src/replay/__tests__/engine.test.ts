// B8 — ReplayEngine tests: pacing math in isolation, then signal-parity against the existing
// synchronous `replayFixture` (ingestion/replay.ts) — the Replay Engine must emit exactly the
// same ordered signals, just paced differently, since it reuses the same B1 normalizer.

import { describe, expect, it } from "vitest";
import type { MatchSignal } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { computeWaitMs, ReplayEngine } from "../engine.js";

describe("computeWaitMs", () => {
  it("scales the raw gap by speed", () => {
    expect(computeWaitMs(1_000, 10_000, 1)).toBe(1_000);
    expect(computeWaitMs(1_000, 10_000, 10)).toBe(100);
  });

  it("clamps the raw gap to maxGapMs before scaling", () => {
    expect(computeWaitMs(60_000, 2_000, 1)).toBe(2_000);
    expect(computeWaitMs(60_000, 2_000, 2)).toBe(1_000);
  });

  it("treats a negative gap as zero", () => {
    expect(computeWaitMs(-500, 2_000, 1)).toBe(0);
  });
});

/** `event` signals carry a freshly randomUUID()'d `id` (ingestion/normalize.ts) — every replay
 *  necessarily mints different ids for the same logical event, so compare structurally with each
 *  event's `id` blanked out rather than asserting a specific value. */
function withoutEventIds(signals: MatchSignal[]): unknown[] {
  return signals.map((signal) => (signal.kind === "event" ? { ...signal, event: { ...signal.event, id: "" } } : signal));
}

describe("ReplayEngine", () => {
  it("with maxGapMs: 0 publishes exactly the same ordered signals as replayFixture", async () => {
    const referenceBus = new MatchSignalBus();
    const reference = replayFixture(referenceBus, FIXTURE_MATCH_ID);

    const replayedSignals: MatchSignal[] = [];
    const bus = new MatchSignalBus();
    bus.subscribe((signal) => replayedSignals.push(signal));

    const engine = new ReplayEngine(bus, { matchId: FIXTURE_MATCH_ID, maxGapMs: 0, speed: 1 });
    await engine.play();

    expect(withoutEventIds(replayedSignals)).toEqual(withoutEventIds(reference));
  }, 20_000);

  it("stop() halts the replay before it completes", async () => {
    const bus = new MatchSignalBus();
    const seen: MatchSignal[] = [];
    let stopped = false;

    const engine = new ReplayEngine(bus, {
      matchId: FIXTURE_MATCH_ID,
      maxGapMs: 0,
      speed: 1,
      onSignal: (signal, index) => {
        seen.push(signal);
        if (index === 5 && !stopped) {
          stopped = true;
          engine.stop();
        }
      },
    });
    await engine.play();

    const referenceBus = new MatchSignalBus();
    const reference = replayFixture(referenceBus, FIXTURE_MATCH_ID);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(reference.length);
  }, 20_000);
});
