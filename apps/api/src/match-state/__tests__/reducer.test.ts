import { describe, expect, it } from "vitest";
import { initialMatchState, reduceMatchState, windowStartForMinute } from "../reducer.js";

const MATCH_ID = "00000000-0000-0000-0000-000000000001";

describe("windowStartForMinute", () => {
  it("floors to the 5-minute boundary", () => {
    expect(windowStartForMinute(0)).toBe(0);
    expect(windowStartForMinute(4)).toBe(0);
    expect(windowStartForMinute(25)).toBe(25);
    expect(windowStartForMinute(29)).toBe(25);
  });

  it("caps at the last regular-time window (85) and floors negatives at 0", () => {
    expect(windowStartForMinute(97)).toBe(85);
    expect(windowStartForMinute(-5)).toBe(0);
  });
});

describe("reduceMatchState", () => {
  it("starts pre-match with zeroed counters", () => {
    const state = initialMatchState(MATCH_ID);
    expect(state).toEqual({
      matchId: MATCH_ID,
      period: "pre",
      currentMinute: 0,
      score: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      corners: { home: 0, away: 0 },
      cards: { home: 0, away: 0 },
    });
  });

  it("applies a deterministic sequence: clock -> event -> possession -> clock, producing the expected final state", () => {
    let state = initialMatchState(MATCH_ID);
    state = reduceMatchState(state, {
      kind: "clock",
      period: "first_half",
      matchMinute: 12,
      running: true,
      timestamp: "t",
    });
    state = reduceMatchState(state, {
      kind: "event",
      event: {
        id: "e1",
        matchId: MATCH_ID,
        eventType: "shot",
        team: "home",
        matchMinute: 12,
        timestamp: "t",
        confirmed: true,
      },
    });
    state = reduceMatchState(state, { kind: "possession", team: "away", timestamp: "t" });
    state = reduceMatchState(state, {
      kind: "clock",
      period: "first_half",
      matchMinute: 27,
      running: true,
      timestamp: "t",
    });

    expect(state).toEqual({
      matchId: MATCH_ID,
      period: "first_half",
      currentMinute: 27,
      activeWindowStartMinute: 25,
      possession: "away",
      score: { home: 0, away: 0 },
      shots: { home: 1, away: 0 },
      corners: { home: 0, away: 0 },
      cards: { home: 0, away: 0 },
    });
  });

  it("moves through period transitions pre -> first_half -> halftime -> second_half -> full_time", () => {
    let state = initialMatchState(MATCH_ID);
    const periods = ["first_half", "halftime", "second_half", "full_time"] as const;
    for (const period of periods) {
      state = reduceMatchState(state, { kind: "clock", period, matchMinute: state.currentMinute, running: true, timestamp: "t" });
      expect(state.period).toBe(period);
    }
  });

  it("attributes counters per team: goal -> score, shot -> shots, corner -> corners, card -> cards", () => {
    let state = initialMatchState(MATCH_ID);
    const events: Array<{ eventType: "goal" | "shot" | "corner" | "card"; team: "home" | "away" }> = [
      { eventType: "goal", team: "home" },
      { eventType: "shot", team: "away" },
      { eventType: "corner", team: "home" },
      { eventType: "card", team: "away" },
    ];
    for (const { eventType, team } of events) {
      state = reduceMatchState(state, {
        kind: "event",
        event: { id: "e", matchId: MATCH_ID, eventType, team, matchMinute: 1, timestamp: "t", confirmed: true },
      });
    }
    expect(state.score).toEqual({ home: 1, away: 0 });
    expect(state.shots).toEqual({ home: 0, away: 1 });
    expect(state.corners).toEqual({ home: 1, away: 0 });
    expect(state.cards).toEqual({ home: 0, away: 1 });
  });

  it("ignores events with team 'any' and event types with no MatchState counter", () => {
    const state = initialMatchState(MATCH_ID);
    const anyGoal = reduceMatchState(state, {
      kind: "event",
      event: { id: "e", matchId: MATCH_ID, eventType: "goal", team: "any", matchMinute: 1, timestamp: "t", confirmed: true },
    });
    expect(anyGoal).toBe(state);

    const substitution = reduceMatchState(state, {
      kind: "event",
      event: { id: "e2", matchId: MATCH_ID, eventType: "substitution", team: "home", matchMinute: 1, timestamp: "t", confirmed: true },
    });
    expect(substitution).toBe(state);
  });

  it("returns the same reference on a no-op signal", () => {
    let state = initialMatchState(MATCH_ID);
    state = reduceMatchState(state, { kind: "clock", period: "first_half", matchMinute: 10, running: true, timestamp: "t" });

    const same = reduceMatchState(state, { kind: "clock", period: "first_half", matchMinute: 10, running: true, timestamp: "t2" });
    expect(same).toBe(state);

    const samePossession = reduceMatchState(state, { kind: "possession", team: "home", timestamp: "t" });
    const stillSame = reduceMatchState(samePossession, { kind: "possession", team: "home", timestamp: "t2" });
    expect(stillSame).toBe(samePossession);
  });
});
