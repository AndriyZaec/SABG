import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot } from "@arena/contracts";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";
import { defaultCs2FixturePath, loadCs2Fixture, replayCs2Fixture } from "../fixture.js";

function snapshot(homeScore: number, awayScore: number, overrides: Partial<Cs2GameSnapshot["teams"][0]> = {}): Cs2GameSnapshot {
  return {
    teams: [
      { name: "Home", score: homeScore, deaths: 0, weaponKills: [], players: [], ...overrides },
      { name: "Away", score: awayScore, deaths: 0, weaponKills: [], players: [] },
    ],
  };
}

describe("trackCs2Poll — synthetic sequences", () => {
  it("emits only cs2_round_lock(1) on the very first live snapshot", () => {
    const { state, signals } = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    expect(signals).toEqual([
      { kind: "cs2_snapshot", snapshot: snapshot(0, 0), timestamp: "t0" },
      { kind: "cs2_round_lock", roundNumber: 1, timestamp: "t0" },
    ]);
    expect(state).toEqual({ roundNumber: 1, lockSnapshot: snapshot(0, 0) });
  });

  it("emits nothing extra while the round number is unchanged", () => {
    const first = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    const second = trackCs2Poll(first.state, snapshot(0, 0), "t1");
    expect(second.signals).toEqual([{ kind: "cs2_snapshot", snapshot: snapshot(0, 0), timestamp: "t1" }]);
    expect(second.state).toEqual(first.state);
  });

  it("emits cs2_round_end then cs2_round_lock when the score advances, winner = the scoring team", () => {
    const opened = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    const after = snapshot(1, 0);
    const { state, signals } = trackCs2Poll(opened.state, after, "t1");
    expect(signals).toEqual([
      { kind: "cs2_snapshot", snapshot: after, timestamp: "t1" },
      { kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: after, timestamp: "t1" },
      { kind: "cs2_round_lock", roundNumber: 2, timestamp: "t1" },
    ]);
    expect(state).toEqual({ roundNumber: 2, lockSnapshot: after });
  });

  it("attributes the win to away when away's score advances", () => {
    const opened = trackCs2Poll(initialCs2TrackerState(), snapshot(0, 0), "t0");
    const { signals } = trackCs2Poll(opened.state, snapshot(0, 1), "t1");
    const roundEnd = signals.find((s) => s.kind === "cs2_round_end");
    expect(roundEnd).toMatchObject({ winner: "away" });
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
  it("derives 30 round locks and 29 round ends from the observed score progression, no match_end", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    const { signals, finalState } = replayCs2Fixture(entries);

    const locks = signals.filter((s) => s.kind === "cs2_round_lock");
    const ends = signals.filter((s) => s.kind === "cs2_round_end");
    const matchEnds = signals.filter((s) => s.kind === "cs2_match_end");

    // Recorded score progression tops out at 14-15 (sum 29) — round 30 is still open when the
    // recording cuts off (recorder never observed the map finish, see plan's finding #4).
    expect(locks).toHaveLength(30);
    expect(ends).toHaveLength(29);
    expect(matchEnds).toHaveLength(0);
    expect(finalState.roundNumber).toBe(30);

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
