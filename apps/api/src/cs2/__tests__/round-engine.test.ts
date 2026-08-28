import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot, PredictionRound } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { Cs2RoundEngine, type Cs2RoundLifecycleEvent } from "../round-engine.js";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";
import { defaultCs2FixturePath, loadCs2Fixture, parseFixtureSnapshot } from "../fixture.js";
import type { Cs2QuestionProvider } from "../question-provider.js";

const MATCH_ID = "00000000-0000-0000-0000-0000000000c2";
const ARENA_ID = "00000000-0000-0000-0000-0000000000a2";
const TEAMS = [
  { teamId: "team-a", name: "Team A" },
  { teamId: "team-b", name: "Team B" },
] as const;

function driveEngineWithFixture(engine: Cs2RoundEngine, bus: MatchSignalBus): void {
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  let trackerState = initialCs2TrackerState();
  const firstSnapshot = parseFixtureSnapshot(entries[0]!.raw);
  if (firstSnapshot === undefined) throw new Error("Fixture has no initial CS2 snapshot");
  engine.onMatchLiveDetected(entries[0]!.receivedAt, firstSnapshot.teams);
  for (const entry of entries) {
    const snapshot = parseFixtureSnapshot(entry.raw);
    const { state, signals } = trackCs2Poll(trackerState, snapshot, entry.receivedAt);
    trackerState = state;
    for (const signal of signals) bus.publish(signal);
  }
}

describe("Cs2RoundEngine — full fixture replay (cs2_series_28, one Bo3 map)", () => {
  it("opens Round 1 on onMatchLiveDetected, then cascades open/lock/settle for every round the tracker observes", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    driveEngineWithFixture(engine, bus);

    const opens = events.filter((e) => e.type === "open");
    const locks = events.filter((e) => e.type === "lock");
    const settles = events.filter((e) => e.type === "settle");
    const voids = events.filter((e) => e.type === "void");

    // The fixture ends after round 30 locks, leaving rounds 30 and 31 unresolved.
    expect(opens).toHaveLength(31);
    expect(locks).toHaveLength(30);
    expect(settles).toHaveLength(29);
    expect(voids).toHaveLength(0);

    expect(opens.map((e) => (e.type === "open" ? e.round.roundNumber : undefined))).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
    expect(settles.map((e) => (e.type === "settle" ? e.roundNumber : undefined))).toEqual(
      Array.from({ length: 29 }, (_, i) => i + 1),
    );

    const round1 = engine.roundsByNumber.get(1);
    expect(round1?.status).toBe("settled");
    expect(round1?.correctAnswer).toBeDefined();
    const round30 = engine.roundsByNumber.get(30);
    expect(round30?.status).toBe("locked");
    const round31 = engine.roundsByNumber.get(31);
    expect(round31?.status).toBe("open");
  });

  it("never has more than one round open at a time", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);
    driveEngineWithFixture(engine, bus);

    let openCount = 0;
    let maxOpen = 0;
    for (const event of events) {
      if (event.type === "open") openCount++;
      if (event.type === "lock" || event.type === "settle" || event.type === "void") {
      }
      if (event.type === "lock") openCount--;
      maxOpen = Math.max(maxOpen, openCount);
    }
    expect(maxOpen).toBe(1);
  });

  it("Round 13 asks the fixed pistol question, Round 24 asks the fixed OT-score question", () => {
    const bus = new MatchSignalBus();
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID);
    engine.subscribeTo(bus);
    driveEngineWithFixture(engine, bus);

    const round13 = engine.roundsByNumber.get(13);
    const round24 = engine.roundsByNumber.get(24);
    expect(round13?.settlementCondition).toMatchObject({ discipline: "cs2", topic: "pistol_round", roundNumber: 13 });
    expect(round24?.settlementCondition).toMatchObject({ discipline: "cs2", topic: "ot_score", roundNumber: 24 });
  });
});

const clock = (currentSeconds: number, ticking = true) => ({ ticking, currentSeconds });
const snapshot = (a: number, b: number, cs = 90): Cs2GameSnapshot => ({
  teams: [
    { teamId: "team-a", name: "Team A", score: a, deaths: 0, weaponKills: [], players: [] },
    { teamId: "team-b", name: "Team B", score: b, deaths: 0, weaponKills: [], players: [] },
  ],
  clock: clock(cs),
});

function fakeProvider(): Cs2QuestionProvider {
  return {
    generate: (ctx) => ({
      question: `Round ${ctx.roundNumber}?`,
      settlementCondition: { discipline: "cs2", topic: "round_winner", params: { targetTeamId: "team-a" }, roundNumber: ctx.roundNumber, resolve: "snapshot_diff" },
    }),
  };
}

describe("Cs2RoundEngine — synthetic match-end voiding", () => {
  it("voids a locked round when its target team identity does not exist", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const questionProvider: Cs2QuestionProvider = {
      generate: (ctx) => ({
        question: "Invalid target?",
        settlementCondition: {
          discipline: "cs2",
          topic: "round_winner",
          params: { targetTeamId: "missing" },
          roundNumber: ctx.roundNumber,
          resolve: "snapshot_diff",
        },
      }),
    };
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, {
      questionProvider,
      onTransition: (event) => events.push(event),
    });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    expect(engine.roundsByNumber.get(1)?.status).toBe("voided");
    expect(events).toContainEqual({
      type: "void",
      roundId: engine.roundsByNumber.get(1)?.id,
      roundNumber: 1,
      reason: "unknown_team_id",
    });
    expect(events.some((event) => event.type === "settle" && event.roundNumber === 1)).toBe(false);
  });

  it("voids the in-flight round when the last snapshot does not prove a score transition", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { questionProvider: fakeProvider(), onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    // No score transition proves a result before match end.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 60), timestamp: "t2" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });

    expect(events.filter((e) => e.type === "settle")).toEqual([]);
    expect(events.filter((e) => e.type === "void").map((e) => e.roundNumber)).toEqual([1, 2]);

    expect(engine.roundsByNumber.get(1)?.status).toBe("voided");
    expect(engine.roundsByNumber.get(2)?.status).toBe("voided");
  });

  it("settles the in-flight round when the last snapshot proves exactly one score transition", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, {
      questionProvider: fakeProvider(),
      onTransition: (event) => events.push(event),
    });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 20), timestamp: "t2" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });

    expect(events.find((event) => event.type === "settle")).toMatchObject({
      type: "settle",
      roundNumber: 1,
      correctAnswer: "yes",
    });
    expect(engine.roundsByNumber.get(1)?.status).toBe("settled");
    expect(engine.roundsByNumber.get(2)?.status).toBe("voided");
  });

  it("voids the currently-open round outright when the match ends before it ever locks", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { questionProvider: fakeProvider(), onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    bus.publish({ kind: "cs2_match_end", timestamp: "t1" });

    expect(events.filter((e) => e.type === "settle")).toHaveLength(0);
    const voided = events.filter((e) => e.type === "void");
    expect(voided).toEqual([{ type: "void", roundId: engine.roundsByNumber.get(1)?.id, roundNumber: 1 }]);
    expect(engine.roundsByNumber.get(1)?.status).toBe("voided");
  });
});

describe("Cs2RoundEngine — resync at the next reliable lock", () => {
  it("voids a stale question and opens the question after the newly-live round", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, {
      questionProvider: fakeProvider(),
      onTransition: (e) => events.push(e),
    });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    // Polling began after round 1's lock; round 2 is the first reliable boundary.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 2, timestamp: "t1" });

    expect(engine.roundsByNumber.get(1)?.status).toBe("voided");
    expect(engine.roundsByNumber.has(2)).toBe(false);
    expect(engine.roundsByNumber.get(3)?.status).toBe("open");
    expect(events.filter((event) => event.type === "void")).toEqual([
      { type: "void", roundId: engine.roundsByNumber.get(1)?.id, roundNumber: 1 },
    ]);
  });
});

describe("Cs2RoundEngine — isArenaFinished gate", () => {
  it("stops opening new rounds once the arena is reported finished, but lets an already-open round settle normally", () => {
    const bus = new MatchSignalBus();
    let finished = false;
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, {
      questionProvider: fakeProvider(),
      isArenaFinished: () => finished,
      onTransition: (e) => events.push(e),
    });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0", TEAMS);
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    finished = true;
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    expect(engine.roundsByNumber.get(1)?.status).toBe("locked");
    expect(engine.roundsByNumber.has(2)).toBe(false);

    const after = snapshot(1, 0, 20);
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: after, timestamp: "t2" });
    expect(engine.roundsByNumber.get(1)?.status).toBe("settled");
  });
});
