import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot } from "@arena/contracts";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";
import { defaultCs2FixturePath, loadCs2Fixture, replayCs2Fixture } from "../fixture.js";

function snapshot(
  homeScore: number,
  awayScore: number,
  clock: Cs2GameSnapshot["clock"] = { ticking: false, currentSeconds: 18 },
  overrides: Partial<Cs2GameSnapshot["teams"][0]> = {},
): Cs2GameSnapshot {
  return {
    teams: [
      { name: "Home", score: homeScore, deaths: 0, weaponKills: [], players: [], ...overrides },
      { name: "Away", score: awayScore, deaths: 0, weaponKills: [], players: [] },
    ],
    clock,
  };
}

describe("trackCs2Poll — synthetic sequences", () => {
  it("does not lock the very first live snapshot ever seen (nothing to compare the clock against)", () => {
    const { state, signals } = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    expect(signals).toEqual([{ kind: "cs2_snapshot", snapshot: snapshot(0, 0), timestamp: "t0" }]);
    expect(state).toEqual({
      lastSnapshot: snapshot(0, 0),
      roundInProgress: 1,
      lockSnapshot: undefined,
      lockedRound: undefined,
    });
  });

  it("emits cs2_round_lock once the clock resets (warmup paused -> live ticking)", () => {
    const warmup = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: false, currentSeconds: 18 }), "t0");
    const live = snapshot(0, 0, { ticking: true, currentSeconds: 105 });
    const { state, signals } = trackCs2Poll(warmup.state, live, "t1");
    expect(signals).toEqual([
      { kind: "cs2_snapshot", snapshot: live, timestamp: "t1" },
      { kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" },
    ]);
    expect(state).toEqual({ lastSnapshot: live, roundInProgress: 1, lockSnapshot: live, lockedRound: 1 });
  });

  it("emits nothing extra while the clock is just counting down within the same round", () => {
    const warmup = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: false, currentSeconds: 18 }), "t0");
    const live = trackCs2Poll(warmup.state, snapshot(0, 0, { ticking: true, currentSeconds: 105 }), "t1");
    const ticking = trackCs2Poll(live.state, snapshot(0, 0, { ticking: true, currentSeconds: 90 }), "t2");
    expect(ticking.signals).toEqual([{ kind: "cs2_snapshot", snapshot: snapshot(0, 0, { ticking: true, currentSeconds: 90 }), timestamp: "t2" }]);
    expect(ticking.state).toEqual({ ...live.state, lastSnapshot: snapshot(0, 0, { ticking: true, currentSeconds: 90 }) });
  });

  it("emits cs2_round_end as soon as the score changes, independently of the next lock", () => {
    const warmup = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: false, currentSeconds: 18 }), "t0");
    const lockedR1 = trackCs2Poll(warmup.state, snapshot(0, 0, { ticking: true, currentSeconds: 105 }), "t1");
    const scoreChanged = snapshot(1, 0, { ticking: true, currentSeconds: 20 });
    const { state, signals } = trackCs2Poll(lockedR1.state, scoreChanged, "t2");
    expect(signals).toEqual([
      { kind: "cs2_snapshot", snapshot: scoreChanged, timestamp: "t2" },
      { kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: scoreChanged, timestamp: "t2" },
    ]);
    expect(state.roundInProgress).toBe(2);
    expect(state.lockedRound).toBe(1);

    const reset = snapshot(1, 0, { ticking: true, currentSeconds: 108 });
    const locked = trackCs2Poll(state, reset, "t3");
    expect(locked.signals).toEqual([
      { kind: "cs2_snapshot", snapshot: reset, timestamp: "t3" },
      { kind: "cs2_round_lock", roundNumber: 2, timestamp: "t3" },
    ]);
  });

  it("attributes the win to away when away's score advances", () => {
    const warmup = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: false, currentSeconds: 18 }), "t0");
    const lockedR1 = trackCs2Poll(warmup.state, snapshot(0, 0, { ticking: true, currentSeconds: 105 }), "t1");
    const { signals } = trackCs2Poll(lockedR1.state, snapshot(0, 1, { ticking: true, currentSeconds: 20 }), "t2");
    const roundEnd = signals.find((s) => s.kind === "cs2_round_end");
    expect(roundEnd).toMatchObject({ winner: "away" });
  });

  it("does not invent a round result when a polling gap skips multiple score changes", () => {
    const warmup = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: false, currentSeconds: 18 }), "t0");
    const lockedR1 = trackCs2Poll(warmup.state, snapshot(0, 0, { ticking: true, currentSeconds: 105 }), "t1");

    const afterGap = trackCs2Poll(lockedR1.state, snapshot(2, 1, { ticking: true, currentSeconds: 40 }), "t2");

    expect(afterGap.signals).toEqual([
      { kind: "cs2_snapshot", snapshot: snapshot(2, 1, { ticking: true, currentSeconds: 40 }), timestamp: "t2" },
    ]);
    expect(afterGap.state.roundInProgress).toBe(4);
    expect(afterGap.state.lockSnapshot).toBeUndefined();
  });

  it("does not synthesize a lock for a round it joined mid-way through (missed the clock reset)", () => {
    const joined = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0, { ticking: true, currentSeconds: 60 }), "t0");
    expect(joined.signals).toEqual([{ kind: "cs2_snapshot", snapshot: snapshot(0, 0, { ticking: true, currentSeconds: 60 }), timestamp: "t0" }]);
    expect(joined.state.lockedRound).toBeUndefined();

    const ended = trackCs2Poll(joined.state, snapshot(1, 0, { ticking: true, currentSeconds: 15 }), "t1");
    expect(ended.signals.some((s) => s.kind === "cs2_round_end")).toBe(false);
    expect(ended.state.roundInProgress).toBe(2);

    const locked = trackCs2Poll(ended.state, snapshot(1, 0, { ticking: true, currentSeconds: 106 }), "t2");
    expect(locked.signals.some((s) => s.kind === "cs2_round_lock" && s.roundNumber === 2)).toBe(true);
  });

  it("emits cs2_match_end and resets state once the live game disappears", () => {
    const opened = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    const { state, signals } = trackCs2Poll(opened.state, undefined, "t1");
    expect(signals).toEqual([{ kind: "cs2_match_end", timestamp: "t1" }]);
    expect(state).toEqual(initialCs2TrackerState());
  });

  it("is a no-op before the match has ever gone live", () => {
    const { state, signals } = trackCs2Poll(initialCs2TrackerState(), undefined, "t0");
    expect(signals).toEqual([]);
    expect(state).toEqual(initialCs2TrackerState());
  });
});

describe("trackCs2Poll — recorded fixture (cs2_series_28, one Bo3 map)", () => {
  it("derives 30 round locks and 29 round ends from the observed clock/score progression, no match_end", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    const { signals, finalState } = replayCs2Fixture(entries);

    const locks = signals.filter((s) => s.kind === "cs2_round_lock");
    const ends = signals.filter((s) => s.kind === "cs2_round_end");
    const matchEnds = signals.filter((s) => s.kind === "cs2_match_end");

    // The fixture ends at 14-15 before the map-finish transition.
    expect(locks).toHaveLength(30);
    expect(ends).toHaveLength(29);
    expect(matchEnds).toHaveLength(0);
    expect(finalState.roundInProgress).toBe(30);

    expect(locks.map((s) => (s.kind === "cs2_round_lock" ? s.roundNumber : undefined))).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    expect(ends.map((s) => (s.kind === "cs2_round_end" ? s.roundNumber : undefined))).toEqual(
      Array.from({ length: 29 }, (_, i) => i + 1),
    );
  });

  it("round 1's winner is the home side (observed score 0-0 -> 1-0)", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    const { signals } = replayCs2Fixture(entries);
    const round1End = signals.find((s) => s.kind === "cs2_round_end" && s.roundNumber === 1);
    expect(round1End).toMatchObject({ winner: "home" });
  });
});
