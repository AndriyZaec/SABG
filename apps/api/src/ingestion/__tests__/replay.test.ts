import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@arena/contracts";
import { LiveEventBus } from "../event-bus.js";
import { createLiveEventProcessor } from "../incident-tracker.js";
import { defaultFixturePath, loadFixture, replayFixture, FIXTURE_MATCH_ID } from "../replay.js";
import type { ScoreSnapshot } from "../score-snapshot.js";

describe("replayFixture", () => {
  it("replays the recorded fixture into a confirmed-only, deduped, whitelisted LiveEvent stream", () => {
    const bus = new LiveEventBus();
    const published: LiveEvent[] = [];
    bus.subscribe((event) => published.push(event));

    const emitted = replayFixture(bus);

    expect(emitted.length).toBeGreaterThan(0);
    expect(published).toEqual(emitted);
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
});
