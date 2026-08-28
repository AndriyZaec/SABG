import { describe, expect, it } from "vitest";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";
import { initialCs2SeriesLifecycleState, processCs2SeriesPoll, type Cs2SeriesLifecycleState } from "../series-lifecycle.js";

const START = "2026-08-11T12:00:00.000Z";
const MIN = 60_000;

function at(offsetMinutes: number): string {
  return new Date(Date.parse(START) + offsetMinutes * MIN).toISOString();
}

function snapshot(opts: { format?: number; teams?: [number, number]; hasLiveGame?: boolean; finished?: boolean }): Cs2SeriesSnapshot {
  const [a, b] = opts.teams ?? [0, 0];
  return {
    format: opts.format ?? 3,
    finished: opts.finished ?? false,
    hasLiveGame: opts.hasLiveGame ?? false,
    teams: [
      { teamId: "team-a", name: "A", score: a, won: false },
      { teamId: "team-b", name: "B", score: b, won: false },
    ],
  };
}

function poll(state: Cs2SeriesLifecycleState, snap: Cs2SeriesSnapshot | undefined, offsetMinutes: number) {
  return processCs2SeriesPoll(state, snap, at(offsetMinutes));
}

describe("processCs2SeriesPoll — Arena #1 opening", () => {
  it("does not open Arena #1 before scheduledStartTime - 10min", () => {
    const state0 = initialCs2SeriesLifecycleState(START);
    const { state, actions } = poll(state0, snapshot({}), -11);
    expect(actions).toEqual([]);
    expect(state.openedThrough).toBe(0);
  });

  it("opens Arena #1 exactly at scheduledStartTime - 10min", () => {
    const state0 = initialCs2SeriesLifecycleState(START);
    const { state, actions } = poll(state0, snapshot({}), -10);
    expect(actions).toEqual([{ type: "open_arena", matchIndex: 1 }]);
    expect(state.openedThrough).toBe(1);
  });

  it("does not re-open Arena #1 on a later poll", () => {
    const state0 = initialCs2SeriesLifecycleState(START);
    const { state: afterOpen } = poll(state0, snapshot({}), -10);
    const { actions } = poll(afterOpen, snapshot({}), -9);
    expect(actions).toEqual([]);
  });
});

describe("processCs2SeriesPoll — cascade Arena #k -> #k+1", () => {
  it("opens Arena #2 reactively once Match 1 ends, series not yet decided", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({}), -10));

    ({ state } = poll(state, snapshot({ hasLiveGame: true }), 0));
    let actions;
    ({ state, actions } = poll(state, snapshot({ hasLiveGame: false, teams: [1, 0] }), 20));

    expect(actions).toEqual([{ type: "match_ended", matchIndex: 1 }, { type: "open_arena", matchIndex: 2 }]);
    expect(state.openedThrough).toBe(2);
    expect(state.matchLiveDetected).toBe(false);
  });

  it("emits match_live_detected on the hasLiveGame rising edge", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({}), -10));
    const { actions } = poll(state, snapshot({ hasLiveGame: true }), 0);
    expect(actions).toEqual([{ type: "match_live_detected", matchIndex: 1 }]);
  });
});

describe("processCs2SeriesPoll — series decided", () => {
  it("Bo2: a 1-1 draw is caught only by k >= format, not by winsNeeded", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({ format: 2 }), -10));

    ({ state } = poll(state, snapshot({ format: 2, hasLiveGame: true }), 0));
    let actions;
    ({ state, actions } = poll(state, snapshot({ format: 2, hasLiveGame: false, teams: [1, 0] }), 20));
    expect(actions).toEqual([{ type: "match_ended", matchIndex: 1 }, { type: "open_arena", matchIndex: 2 }]);

    ({ state } = poll(state, snapshot({ format: 2, hasLiveGame: true, teams: [1, 0] }), 30));
    ({ state, actions } = poll(state, snapshot({ format: 2, hasLiveGame: false, teams: [1, 1] }), 50));
    expect(actions).toEqual([
      { type: "match_ended", matchIndex: 2 },
      { type: "series_decided", reason: "all_maps_played" },
    ]);
    expect(state.decided).toBe(true);
  });

  it("Bo3: an early 2-0 clinch decides the series before all maps are played", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({ format: 3 }), -10));

    ({ state } = poll(state, snapshot({ format: 3, hasLiveGame: true }), 0));
    ({ state } = poll(state, snapshot({ format: 3, hasLiveGame: false, teams: [1, 0] }), 20));
    expect(state.openedThrough).toBe(2);

    ({ state } = poll(state, snapshot({ format: 3, hasLiveGame: true, teams: [1, 0] }), 30));
    const { actions } = poll(state, snapshot({ format: 3, hasLiveGame: false, teams: [2, 0] }), 50);
    expect(actions).toEqual([
      { type: "match_ended", matchIndex: 2 },
      { type: "series_decided", reason: "clinch" },
    ]);
  });
});

describe("processCs2SeriesPoll — forfeit cancellation", () => {
  it("cancels Arena #k+1 the moment the series-level score shows it decided, without waiting for MLD", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({ format: 3 }), -10));
    ({ state } = poll(state, snapshot({ format: 3, hasLiveGame: true }), 0));
    ({ state } = poll(state, snapshot({ format: 3, hasLiveGame: false, teams: [1, 0] }), 20));
    expect(state.openedThrough).toBe(2);
    expect(state.matchLiveDetected).toBe(false);

    // A forfeit can decide the series without a live-game edge.
    const { state: after, actions } = poll(
      state,
      snapshot({ format: 3, hasLiveGame: false, teams: [2, 0], finished: true }),
      22,
    );
    expect(actions).toEqual([
      { type: "cancel_arena", matchIndex: 2, reason: "series_decided" },
      { type: "series_decided", reason: "clinch" },
    ]);
    expect(after.decided).toBe(true);
  });
});

describe("processCs2SeriesPoll — Arena #1 no-show", () => {
  it("cancels Arena #1 and marks the series invalid after 60min with no Match Live Detected", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({}), -10));

    const { state: after, actions } = poll(state, snapshot({ hasLiveGame: false }), 61);
    expect(actions).toEqual([{ type: "cancel_arena", matchIndex: 1, reason: "no_show" }]);
    expect(after.invalid).toBe(true);
    expect(after.decided).toBe(false);
  });

  it("does not fire before the 60min mark", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({}), -10));
    const { actions } = poll(state, snapshot({ hasLiveGame: false }), 59);
    expect(actions).toEqual([]);
  });
});

describe("processCs2SeriesPoll — terminal states ignore further polls", () => {
  it("emits nothing once decided", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({ format: 1 }), -10));
    ({ state } = poll(state, snapshot({ format: 1, hasLiveGame: true }), 0));
    ({ state } = poll(state, snapshot({ format: 1, hasLiveGame: false, teams: [1, 0] }), 20));
    expect(state.decided).toBe(true);

    const { actions } = poll(state, snapshot({ format: 1, hasLiveGame: true }), 30);
    expect(actions).toEqual([]);
  });

  it("emits nothing once invalid", () => {
    let state = initialCs2SeriesLifecycleState(START);
    ({ state } = poll(state, snapshot({}), -10));
    ({ state } = poll(state, snapshot({ hasLiveGame: false }), 61));
    expect(state.invalid).toBe(true);

    const { actions } = poll(state, snapshot({ hasLiveGame: true }), 62);
    expect(actions).toEqual([]);
  });
});
