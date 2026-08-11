import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot, PredictionRound } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { Cs2RoundEngine, type Cs2RoundLifecycleEvent } from "../round-engine.js";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";
import { defaultCs2FixturePath, loadCs2Fixture } from "../fixture.js";
import { parseSnapshot } from "../snapshot.js";
import type { Cs2QuestionProvider } from "../question-provider.js";

const MATCH_ID = "00000000-0000-0000-0000-0000000000c2";
const ARENA_ID = "00000000-0000-0000-0000-0000000000a2";

/** Replays the recorded fixture through the real round-tracker onto a fresh bus, with the engine
 *  subscribed — the same "known-good pure reducer feeds the engine under test" shape as
 *  round-tracker.test.ts's own fixture replay, just one layer up. */
function driveEngineWithFixture(engine: Cs2RoundEngine, bus: MatchSignalBus): void {
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  let trackerState = initialCs2TrackerState();
  engine.onMatchLiveDetected(entries[0]!.receivedAt);
  for (const entry of entries) {
    const snapshot = parseSnapshot(entry.raw);
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

    // Round 30 also gets its own lock in this fixture (its freezetime finishes at the very last
    // recorded poll), which cascades open Round 31 — same 30 locks as round-tracker.test.ts,
    // plus the one extra open that lock triggers. The fixture then cuts off: Round 30 never
    // settles (no round_end) and Round 31 never locks.
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
    expect(round30?.status).toBe("locked"); // opened, locked, never settled — fixture ends mid-round
    const round31 = engine.roundsByNumber.get(31);
    expect(round31?.status).toBe("open"); // opened by round 30's lock, never itself locked
  });

  it("never has more than one round open at a time (spec §6 invariant)", () => {
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
        // lock transitions the just-opened round out of "open" (into locked); settle/void only
        // ever apply to already-locked/open rounds, not double-counted here.
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
    { name: "Home", score: a, deaths: 0, weaponKills: [], players: [] },
    { name: "Away", score: b, deaths: 0, weaponKills: [], players: [] },
  ],
  clock: clock(cs),
});

function fakeProvider(): Cs2QuestionProvider {
  return {
    generate: (ctx) => ({
      question: `Round ${ctx.roundNumber}?`,
      settlementCondition: { discipline: "cs2", topic: "round_winner", params: { targetTeam: "home" }, roundNumber: ctx.roundNumber, resolve: "snapshot_diff" },
    }),
  };
}

describe("Cs2RoundEngine — synthetic match-end voiding", () => {
  it("settles the in-flight round from the last known snapshot, then voids the round opened after its lock", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { questionProvider: fakeProvider(), onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0");
    // Round 1 locks (warmup -> live): opens Round 2.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    // The match ends mid-Round-1 (score never advanced) — no cs2_round_end ever arrives, just
    // one more snapshot (best-available "after") followed by match_end.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 60), timestamp: "t2" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });

    const settle1 = events.find((e) => e.type === "settle");
    expect(settle1).toMatchObject({ type: "settle", roundNumber: 1, correctAnswer: "no" }); // score never changed
    const void2 = events.find((e) => e.type === "void");
    expect(void2).toMatchObject({ type: "void", roundNumber: 2 });

    expect(engine.roundsByNumber.get(1)?.status).toBe("settled");
    expect(engine.roundsByNumber.get(2)?.status).toBe("voided");
  });

  it("voids the currently-open round outright when the match ends before it ever locks", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { questionProvider: fakeProvider(), onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    engine.onMatchLiveDetected("t0"); // Round 1 opens, never locks
    bus.publish({ kind: "cs2_match_end", timestamp: "t1" });

    expect(events.filter((e) => e.type === "settle")).toHaveLength(0);
    const voided = events.filter((e) => e.type === "void");
    expect(voided).toEqual([{ type: "void", roundId: engine.roundsByNumber.get(1)?.id, roundNumber: 1 }]);
    expect(engine.roundsByNumber.get(1)?.status).toBe("voided");
  });
});

describe("Cs2RoundEngine — fallback when Round 1's lock arrives before onMatchLiveDetected", () => {
  it("skips the lock and does not start the cascade", () => {
    const bus = new MatchSignalBus();
    const events: Cs2RoundLifecycleEvent[] = [];
    const engine = new Cs2RoundEngine(MATCH_ID, ARENA_ID, { onTransition: (e) => events.push(e) });
    engine.subscribeTo(bus);

    // No onMatchLiveDetected() call — Round 1 was never opened.
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t0" });

    expect(events).toEqual([]);
    expect(engine.roundsByNumber.size).toBe(0);
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

    engine.onMatchLiveDetected("t0");
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    finished = true;
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" }); // locks Round 1, but no Round 2 opened

    expect(engine.roundsByNumber.get(1)?.status).toBe("locked");
    expect(engine.roundsByNumber.has(2)).toBe(false);

    const after = snapshot(1, 0, 20);
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: after, timestamp: "t2" });
    expect(engine.roundsByNumber.get(1)?.status).toBe("settled");
  });
});
