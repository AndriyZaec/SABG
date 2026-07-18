import { describe, expect, it } from "vitest";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { RoundEngine, type RoundLifecycleEvent } from "../engine.js";
import { TARGET_WINDOW_STARTS } from "../planner.js";
import type { QuestionContext, QuestionProvider } from "../question-provider.js";

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
    expect(openEvent.round.windowStartMinute).toBe(5);
    expect(openEvent.round.windowEndMinute).toBe(10);
    expect(openEvent.round.status).toBe("open");
    expect(openEvent.round.arenaId).toBe(ARENA_ID);
    expect(openEvent.round.matchId).toBe(FIXTURE_MATCH_ID);
    expect(openEvent.round.settlementCondition).toEqual({
      targetEventType: "shot",
      targetTeam: "any",
      windowStartMinute: 5,
      windowEndMinute: 10,
      resolve: "event_in_window",
    });
    // lockAt is a display estimate only — just confirm it's a well-formed timestamp.
    expect(new Date(openEvent.lockAt).getTime()).not.toBeNaN();
    expect(engine.roundsByWindow.get(5)?.status).toBe("open");

    bus.publish({ kind: "clock", period: "first_half", matchMinute: 5, running: true, timestamp: "t1" });

    const lockEvent = events.find((e) => e.type === "lock");
    expect(lockEvent).toEqual({ type: "lock", roundId: openEvent.round.id, windowStartMinute: 5 });
    const stored = engine.roundsByWindow.get(5);
    expect(stored?.status).toBe("locked");
    expect(stored?.id).toBe(openEvent.round.id); // same round, updated in place — not a new one
    expect(stored?.lockedAt).toBeDefined();
  });

  it("forwards teamNames from RoundEngineOptions into the QuestionContext on every open", () => {
    const bus = new MatchSignalBus();
    const contexts: QuestionContext[] = [];
    const fakeProvider: QuestionProvider = {
      generate(ctx) {
        contexts.push(ctx);
        return {
          question: "q",
          targetEventType: "shot",
          targetTeam: "any",
          settlementCondition: {
            targetEventType: "shot",
            targetTeam: "any",
            windowStartMinute: ctx.windowStartMinute,
            windowEndMinute: ctx.windowEndMinute,
            resolve: "event_in_window",
          },
        };
      },
    };
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
      questionProvider: fakeProvider,
      teamNames: { home: "England", away: "Argentina" },
    });
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "pre", matchMinute: 0, running: false, timestamp: "t0" });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.teamNames).toEqual({ home: "England", away: "Argentina" });
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

  it("replaying fixture 18179764 opens and locks exactly the 16 non-halftime windows, in order, one at a time", () => {
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

    // All 16 rounds end up locked in the engine's own map.
    expect(engine.roundsByWindow.size).toBe(16);
    for (const round of engine.roundsByWindow.values()) {
      expect(round.status).toBe("locked");
    }
  });

  it("opens no rounds once isArenaFinished is true (winners already declared)", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
      onTransition: (e) => events.push(e),
      isArenaFinished: () => true,
    });
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "pre", matchMinute: 0, running: false, timestamp: "t0" });
    bus.publish({ kind: "clock", period: "first_half", matchMinute: 5, running: true, timestamp: "t1" });

    expect(events).toHaveLength(0);
    expect(engine.roundsByWindow.size).toBe(0);
  });

  it("stops opening further rounds once the arena finishes mid-match, but still locks the round already open at that moment", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    let finished = false;
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
      onTransition: (e) => events.push(e),
      isArenaFinished: () => finished,
    });
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "pre", matchMinute: 0, running: false, timestamp: "t0" });
    expect(engine.roundsByWindow.get(5)?.status).toBe("open");

    // Arena finishes (e.g. one-survivor early finish) before the next window would open.
    finished = true;

    bus.publish({ kind: "clock", period: "first_half", matchMinute: 5, running: true, timestamp: "t1" });
    bus.publish({ kind: "clock", period: "first_half", matchMinute: 10, running: true, timestamp: "t2" });
    bus.publish({ kind: "clock", period: "first_half", matchMinute: 15, running: true, timestamp: "t3" });

    const openedSequence = events
      .filter((e): e is Extract<RoundLifecycleEvent, { type: "open" }> => e.type === "open")
      .map((e) => e.round.windowStartMinute);
    expect(openedSequence).toEqual([5]); // only the pre-finish round ever opened

    // The round that was already open before the finish still locks normally — it doesn't dangle.
    const lockedSequence = events
      .filter((e): e is Extract<RoundLifecycleEvent, { type: "lock" }> => e.type === "lock")
      .map((e) => e.windowStartMinute);
    expect(lockedSequence).toEqual([5]);
    expect(engine.roundsByWindow.get(5)?.status).toBe("locked");

    // No phantom rounds materialize for the later windows the planner "thinks" it opened.
    expect(engine.roundsByWindow.size).toBe(1);
  });

  it("re-checks isArenaFinished per action, so a same-tick lock->open doesn't slip through when the lock synchronously declares finish", () => {
    const bus = new MatchSignalBus();
    const events: RoundLifecycleEvent[] = [];
    let finished = false;
    const engine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
      isArenaFinished: () => finished,
      onTransition: (e) => {
        events.push(e);
        // Mirrors arena-runtime.ts: settling a locked round can synchronously declare the finish
        // (early-settle -> leaderboard finish) before the planner's queued "open" for the next
        // window is executed in this same apply() call.
        if (e.type === "lock") finished = true;
      },
    });
    engine.subscribeTo(bus);

    bus.publish({ kind: "clock", period: "pre", matchMinute: 0, running: false, timestamp: "t0" });
    // Window 5 locks and window 10 would open in this single tick — the planner queues both.
    bus.publish({ kind: "clock", period: "first_half", matchMinute: 5, running: true, timestamp: "t1" });

    const openedSequence = events
      .filter((e): e is Extract<RoundLifecycleEvent, { type: "open" }> => e.type === "open")
      .map((e) => e.round.windowStartMinute);
    expect(openedSequence).toEqual([5]); // window 10 must not open despite being queued alongside the lock

    expect(engine.roundsByWindow.size).toBe(1);
    expect(engine.roundsByWindow.get(5)?.status).toBe("locked");
  });
});
