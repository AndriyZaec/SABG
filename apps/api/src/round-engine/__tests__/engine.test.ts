import { describe, expect, it } from "vitest";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { RoundEngine, type RoundLifecycleEvent } from "../engine.js";
import { TARGET_WINDOW_STARTS } from "../planner.js";

const ARENA_ID = "00000000-0000-0000-0000-000000000099";

describe("RoundEngine", () => {
  it("builds a PredictionRound from the QuestionProvider on open, and updates it in place on lock", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "pre", matchMinute: 0, running: false, timestamp: "t0" });

    expect(events).toHaveLength(1);
    const openEvent = events[0];
    if (openEvent?.type !== "open") throw new Error("expected an open event");
    expect(openEvent.round.windowStartMinute).toBe(0);
    expect(openEvent.round.windowEndMinute).toBe(5);
    expect(openEvent.round.status).toBe("open");
    expect(openEvent.round.arenaId).toBe(ARENA_ID);
    expect(openEvent.round.matchId).toBe(FIXTURE_MATCH_ID);
    expect(openEvent.round.settlementCondition).toEqual({
      targetEventType: "shot",
      targetTeam: "any",
      windowStartMinute: 0,
      windowEndMinute: 5,
      resolve: "event_in_window",
    });
    // lockAt is a display estimate only — just confirm it's a well-formed timestamp.
    expect(new Date(openEvent.lockAt).getTime()).not.toBeNaN();
    expect(engine.roundsByWindow.get(0)?.status).toBe("open");

    bus.publish({ kind: "clock", period: "first_half", matchMinute: 0, running: true, timestamp: "t1" });

    const lockEvent = events.find((e) => e.type === "lock");
    expect(lockEvent).toEqual({ type: "lock", roundId: openEvent.round.id, windowStartMinute: 0 });
    const stored = engine.roundsByWindow.get(0);
    expect(stored?.status).toBe("locked");
    expect(stored?.id).toBe(openEvent.round.id); // same round, updated in place — not a new one
    expect(stored?.lockedAt).toBeDefined();
  });

  it("ignores non-clock signals (event, possession)", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    bus.publish({ kind: "possession", team: "home", timestamp: "t" });
    bus.publish({
      kind: "event",
      event: {
        id: "e1",
        matchId: FIXTURE_MATCH_ID,
        eventType: "shot",
        team: "home",
        matchMinute: 3,
        timestamp: "t",
        confirmed: true,
      },
    });

    expect(events).toHaveLength(0);
    expect(engine.roundsByWindow.size).toBe(0);
  });

  it("replaying fixture 18179764 opens and locks exactly the 17 non-halftime windows, in order, one at a time", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    replayFixture(bus, FIXTURE_MATCH_ID);

    const openedSequence = events
      .filter((e): e is Extract<RoundLifecycleEvent, { type: "open" }> => e.type === "open")
      .map((e) => e.round.windowStartMinute);
    const lockedSequence = events
      .filter((e): e is Extract<RoundLifecycleEvent, { type: "lock" }> => e.type === "lock")
      .map((e) => e.windowStartMinute);

    expect(openedSequence).toEqual(TARGET_WINDOW_STARTS);
    expect(lockedSequence).toEqual(TARGET_WINDOW_STARTS);
    expect(openedSequence.includes(45)).toBe(false); // halftime window never opens

    // At most one open round at a time: every open is followed by its own lock before the next open.
    let currentlyOpen: number | undefined;
    for (const event of events) {
      if (event.type === "open") {
        expect(currentlyOpen).toBeUndefined();
        currentlyOpen = event.round.windowStartMinute;
      } else {
        expect(currentlyOpen).toBe(event.windowStartMinute);
        currentlyOpen = undefined;
      }
    }
    expect(currentlyOpen).toBeUndefined();

    // All 17 rounds end up locked in the engine's own map.
    expect(engine.roundsByWindow.size).toBe(17);
    for (const round of engine.roundsByWindow.values()) {
      expect(round.status).toBe("locked");
    }
  });
});
