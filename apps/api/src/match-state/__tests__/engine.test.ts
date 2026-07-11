import { describe, expect, it } from "vitest";
import type { MatchState } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { createMatchSignalProducer } from "../../ingestion/match-signal.js";
import { defaultFixturePath, loadFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { MatchStateEngine } from "../engine.js";

describe("MatchStateEngine", () => {
  it("fires onSnapshot only when state actually changes", () => {
    const snapshots: MatchState[] = [];
    const engine = new MatchStateEngine(FIXTURE_MATCH_ID, (s) => snapshots.push(s));

    engine.apply({ kind: "clock", period: "first_half", matchMinute: 10, running: true, timestamp: "t" });
    engine.apply({ kind: "clock", period: "first_half", matchMinute: 10, running: true, timestamp: "t2" }); // no-op
    engine.apply({ kind: "possession", team: "home", timestamp: "t" });

    expect(snapshots).toHaveLength(2);
    expect(engine.snapshot.currentMinute).toBe(10);
    expect(engine.snapshot.possession).toBe("home");
  });

  it("subscribeTo(bus) applies every published signal", () => {
    const bus = new MatchSignalBus();
    const engine = new MatchStateEngine(FIXTURE_MATCH_ID);
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "first_half", matchMinute: 5, running: true, timestamp: "t" });

    expect(engine.snapshot.currentMinute).toBe(5);
    expect(engine.snapshot.period).toBe("first_half");
  });

  it("replaying fixture 18179764 through the producer yields the known final MatchState", () => {
    const producer = createMatchSignalProducer(FIXTURE_MATCH_ID);
    const engine = new MatchStateEngine(FIXTURE_MATCH_ID);

    for (const raw of loadFixture(defaultFixturePath())) {
      for (const signal of producer.process(raw)) {
        engine.apply(signal);
      }
    }

    const final = engine.snapshot;
    expect(final.period).toBe("full_time");
    expect(final.score.home + final.score.away).toBe(3);
    expect(final.corners.home + final.corners.away).toBe(8);
    expect(final.cards.home + final.cards.away).toBe(2);
    expect(final.shots.home + final.shots.away).toBe(18);
  });
});
