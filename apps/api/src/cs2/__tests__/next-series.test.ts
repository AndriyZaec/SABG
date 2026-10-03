import { describe, expect, it } from "vitest";
import { selectNextSeries, type Cs2SeriesCandidate } from "../next-series.js";

const NOW = "2026-10-04T09:00:00.000Z";
const MIN = 60_000;

function minutesFromNow(minutes: number): string {
  return new Date(Date.parse(NOW) + minutes * MIN).toISOString();
}

function candidate(seriesId: string, overrides: Partial<Cs2SeriesCandidate> = {}): Cs2SeriesCandidate {
  return {
    seriesId,
    scheduledStartTime: minutesFromNow(5),
    priority: false,
    followerCount: 0,
    selectable: true,
    status: "active",
    hasArena: false,
    skipRequested: false,
    ...overrides,
  };
}

const neverCalled = () => {
  throw new Error("random must not decide this");
};

describe("selectNextSeries", () => {
  it("prefers the earliest start over a later priority series", () => {
    const result = selectNextSeries(
      [candidate("later-priority", { scheduledStartTime: minutesFromNow(6), priority: true }), candidate("earliest")],
      NOW,
      () => 0.5,
    );
    expect(result).toEqual({ kind: "launch", seriesId: "earliest" });
  });

  it("gives a simultaneous start to the priority series, even against more followers", () => {
    const result = selectNextSeries(
      [candidate("popular", { followerCount: 50 }), candidate("priority", { priority: true })],
      NOW,
      () => 0.5,
    );
    expect(result).toEqual({ kind: "launch", seriesId: "priority" });
  });

  it("breaks a simultaneous start without priority by follower count", () => {
    const result = selectNextSeries(
      [candidate("few", { followerCount: 1 }), candidate("many", { followerCount: 3 })],
      NOW,
      () => 0.5,
    );
    expect(result).toEqual({ kind: "launch", seriesId: "many" });
  });

  it("breaks a full tie with the injected random draw", () => {
    const series = [candidate("a"), candidate("b")];
    const draws = (values: number[]) => () => values.shift()!;
    expect(selectNextSeries(series, NOW, draws([0.9, 0.1]))).toEqual({ kind: "launch", seriesId: "b" });
    expect(selectNextSeries(series, NOW, draws([0.1, 0.9]))).toEqual({ kind: "launch", seriesId: "a" });
  });

  it("still launches a series that started 29 min ago, but not 31 min ago", () => {
    expect(selectNextSeries([candidate("late", { scheduledStartTime: minutesFromNow(-29) })], NOW, Math.random)).toEqual({
      kind: "launch",
      seriesId: "late",
    });
    expect(selectNextSeries([candidate("too-late", { scheduledStartTime: minutesFromNow(-31) })], NOW, Math.random)).toEqual({
      kind: "none",
    });
  });

  it.each<[string, Partial<Cs2SeriesCandidate>]>([
    ["not selectable", { selectable: false }],
    ["already has an arena", { hasArena: true }],
    ["skip requested", { skipRequested: true }],
    ["decided", { status: "decided" }],
    ["invalid", { status: "invalid" }],
    ["skipped", { status: "skipped" }],
  ])("excludes a series that is %s", (_label, overrides) => {
    const result = selectNextSeries(
      [candidate("excluded", { ...overrides, priority: true }), candidate("fallback", { scheduledStartTime: minutesFromNow(8) })],
      NOW,
      () => 0.5,
    );
    expect(result).toEqual({ kind: "launch", seriesId: "fallback" });
  });

  it("launches exactly 10 min before the start and waits at 11 min", () => {
    expect(selectNextSeries([candidate("s", { scheduledStartTime: minutesFromNow(10) })], NOW, () => 0)).toEqual({
      kind: "launch",
      seriesId: "s",
    });
    expect(selectNextSeries([candidate("s", { scheduledStartTime: minutesFromNow(11) })], NOW, () => 0)).toEqual({
      kind: "wait",
      seriesId: "s",
      at: minutesFromNow(1),
    });
  });

  it("returns none for an empty list", () => {
    expect(selectNextSeries([], NOW, neverCalled)).toEqual({ kind: "none" });
  });
});
