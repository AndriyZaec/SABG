import { describe, expect, it } from "vitest";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";
import { decideSeriesEntry } from "../series-entry.js";

function snapshot(opts: {
  format: number | undefined;
  teams: [number, number];
  hasLiveGame: boolean;
  finished?: boolean;
}): Cs2SeriesSnapshot {
  return {
    format: opts.format,
    finished: opts.finished ?? false,
    hasLiveGame: opts.hasLiveGame,
    mapNames: [],
    teams: [
      { teamId: "team-a", name: "A", score: opts.teams[0], won: false },
      { teamId: "team-b", name: "B", score: opts.teams[1], won: false },
    ],
  };
}

describe("decideSeriesEntry", () => {
  it.each([1, 3, 5])("enters at map 1 when a Bo%i is 0:0 with no live game", (format) => {
    expect(decideSeriesEntry(snapshot({ format, teams: [0, 0], hasLiveGame: false }))).toEqual({ kind: "enter_map_1" });
  });

  it.each([3, 5])("enters after map 1 when a Bo%i is 0:0 with map 1 live", (format) => {
    expect(decideSeriesEntry(snapshot({ format, teams: [0, 0], hasLiveGame: true }))).toEqual({ kind: "enter_after_map_1" });
  });

  it("skips a Bo1 whose only map is live", () => {
    expect(decideSeriesEntry(snapshot({ format: 1, teams: [0, 0], hasLiveGame: true }))).toEqual({
      kind: "skip",
      reason: "bo1_in_progress",
    });
  });

  it("skips a live 0:0 series of unknown format rather than guess there is a map 2", () => {
    expect(decideSeriesEntry(snapshot({ format: undefined, teams: [0, 0], hasLiveGame: true }))).toEqual({
      kind: "skip",
      reason: "bo1_in_progress",
    });
  });

  const started: [number, number][] = [
    [1, 0],
    [0, 1],
    [2, 0],
    [1, 1],
  ];
  for (const format of [3, 5]) {
    for (const teams of started) {
      for (const hasLiveGame of [false, true]) {
        it(`skips a Bo${format} at ${teams.join(":")}${hasLiveGame ? " with a live map" : ""}`, () => {
          expect(decideSeriesEntry(snapshot({ format, teams, hasLiveGame }))).toEqual({
            kind: "skip",
            reason: "already_started",
          });
        });
      }
    }
  }

  it("skips a decided Bo1", () => {
    expect(decideSeriesEntry(snapshot({ format: 1, teams: [1, 0], hasLiveGame: false }))).toEqual({
      kind: "skip",
      reason: "already_started",
    });
  });

  it("skips a series GRID already finished at 0:0", () => {
    expect(decideSeriesEntry(snapshot({ format: 3, teams: [0, 0], hasLiveGame: false, finished: true }))).toEqual({
      kind: "skip",
      reason: "finished",
    });
  });
});
