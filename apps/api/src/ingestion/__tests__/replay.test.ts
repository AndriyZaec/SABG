import { describe, expect, it } from "vitest";
import type { LiveEvent, MatchSignal } from "@arena/contracts";
import { MatchSignalBus } from "../event-bus.js";
import { createLiveEventProcessor } from "../incident-tracker.js";
import { defaultFixturePath, loadFixture, replayFixture, FIXTURE_MATCH_ID } from "../replay.js";
import type { ScoreSnapshot } from "../score-snapshot.js";

describe("replayFixture", () => {
  it("replays the recorded fixture into a confirmed-only, deduped, whitelisted LiveEvent stream", () => {
    const bus = new MatchSignalBus();
    const published: MatchSignal[] = [];
    bus.subscribe((signal) => published.push(signal));

    const signals = replayFixture(bus);
    expect(published).toEqual(signals);

    const emitted = signals
      .filter((s): s is Extract<MatchSignal, { kind: "event" }> => s.kind === "event")
      .map((s) => s.event);

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every((e) => e.confirmed)).toBe(true);

    // Only whitelisted target types ever appear — in particular no free_kick, no possession/throw_in noise.
    const eventTypes = new Set(emitted.map((e) => e.eventType));
    for (const type of eventTypes) {
      expect(["shot", "shot_on_target", "corner", "card", "goal", "penalty", "substitution"]).toContain(type);
    }

    // Every derived minute stays within the match's actual span (kickoff through ~52' +
    // second-half stoppage in this fixture).
    for (const event of emitted) {
      expect(event.matchMinute).toBeGreaterThanOrEqual(0);
      expect(event.matchMinute).toBeLessThanOrEqual(97);
    }

    // Exactly one emission per incident: the feed's Id (preserved in rawPayload) never repeats.
    const rawIds = emitted.map((e) => (e.rawPayload as ScoreSnapshot).Id);
    expect(rawIds.every((id) => id !== undefined)).toBe(true);
    expect(new Set(rawIds).size).toBe(rawIds.length);

    // Emission preserves the fixture's recorded arrival (Seq) order — a fresh processor run
    // over the same fixture reproduces the same sequence.
    const expected: LiveEvent[] = [];
    const processor = createLiveEventProcessor(FIXTURE_MATCH_ID);
    for (const raw of loadFixture(defaultFixturePath())) {
      const event = processor.process(raw);
      if (event !== null) expected.push(event);
    }
    expect(emitted.map((e) => e.eventType)).toEqual(expected.map((e) => e.eventType));
    expect(emitted.map((e) => e.matchMinute)).toEqual(expected.map((e) => e.matchMinute));

    const countsByType = Object.fromEntries(
      [...eventTypes].map((type) => [type, emitted.filter((e) => e.eventType === type).length]),
    );
    expect(countsByType).toEqual({
      goal: 3,
      corner: 8,
      card: 2,
      shot: 18,
      substitution: 9,
    });
  });

  it("also emits clock and possession signals derived from the raw feed", () => {
    const bus = new MatchSignalBus();
    const signals = replayFixture(bus);

    const clockSignals = signals.filter((s) => s.kind === "clock");
    const possessionSignals = signals.filter((s) => s.kind === "possession");

    expect(clockSignals.length).toBeGreaterThan(0);
    expect(possessionSignals.length).toBeGreaterThan(0);

    // Period progresses through the match without regressing (pre -> first_half -> halftime ->
    // second_half -> full_time), matching the fixture's recorded StatusId transitions. Most
    // clock signals just tick the minute within the same period, so dedupe consecutive periods.
    const periods = clockSignals.map((s) => (s.kind === "clock" ? s.period : undefined));
    const distinctPeriods = periods.filter((p, i) => p !== periods[i - 1]);
    expect(distinctPeriods).toEqual(["pre", "first_half", "halftime", "second_half", "full_time"]);

    // The derived minute is monotonic *within* a period, but deliberately resets across the
    // H1 -> H2 boundary: the feed's elapsed clock climbs into first-half stoppage (~52' in this
    // fixture) then the second-half clock restarts at 45:00 and counts back up past it. Callers
    // must key window logic off (period, matchMinute) together, never matchMinute alone (B3).
    const ticks = clockSignals.filter((s): s is Extract<typeof s, { kind: "clock" }> => s.kind === "clock");
    const byPeriod = new Map<string, number[]>();
    for (const tick of ticks) {
      const minutes = byPeriod.get(tick.period) ?? [];
      minutes.push(tick.matchMinute);
      byPeriod.set(tick.period, minutes);
    }
    for (const minutes of byPeriod.values()) {
      for (let i = 1; i < minutes.length; i++) {
        expect(minutes[i]).toBeGreaterThanOrEqual(minutes[i - 1]!);
      }
    }
    // The reset actually happens: second-half minutes start back near 45, well below the
    // first-half stoppage high-water mark (~52).
    const firstHalfMinutes = byPeriod.get("first_half") ?? [];
    const secondHalfMinutes = byPeriod.get("second_half") ?? [];
    expect(Math.max(...firstHalfMinutes)).toBeGreaterThan(45);
    expect(secondHalfMinutes[0]).toBeLessThanOrEqual(46);
  });
});
