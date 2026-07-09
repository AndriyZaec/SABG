import { describe, expect, it } from "vitest";
import { TARGET_EVENT_TYPES } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { TARGET_WINDOW_STARTS } from "../../round-engine/planner.js";
import { createQuestionGenerator, type QuestionGenerator } from "../engine.js";

const MATCH_ID = "00000000-0000-0000-0000-000000000010";
const ARENA_ID = "00000000-0000-0000-0000-000000000020";

function ctx(windowStartMinute: number) {
  return { matchId: MATCH_ID, arenaId: ARENA_ID, windowStartMinute, windowEndMinute: windowStartMinute + 5 };
}

/**
 * Drives `generate()` the way RoundEngine actually does — once per round, at the real match
 * window starts (0,5,...,40,50,...,85), not a dense run of consecutive integers. Reachability of
 * a given (type, team) combo is path-dependent on the anti-repeat filter's call history, so a
 * dense synthetic sweep (e.g. windowStartMinute 0..49) can land in an unrealistic cycle that
 * never revisits a reachable combo — repeating several realistic "matches" worth of calls avoids
 * that without asserting on an input shape the engine is never actually driven with.
 */
function realisticPicks(generator: QuestionGenerator, matches = 5) {
  const picks = [];
  for (let m = 0; m < matches; m++) {
    for (const windowStart of TARGET_WINDOW_STARTS) picks.push(generator.generate(ctx(windowStart)));
  }
  return picks;
}

function substitutionEvent(team: "home" | "away" | "any", confirmed = true) {
  return {
    kind: "event" as const,
    event: {
      id: crypto.randomUUID(),
      matchId: MATCH_ID,
      eventType: "substitution" as const,
      team,
      matchMinute: 10,
      timestamp: "t",
      confirmed,
    },
  };
}

describe("QuestionGenerator", () => {
  it("generates a valid whitelisted question with a settlementCondition matching the round's window", () => {
    const generator = createQuestionGenerator();
    const generated = generator.generate(ctx(20));

    expect(TARGET_EVENT_TYPES).toContain(generated.targetEventType);
    expect(["home", "away", "any"]).toContain(generated.targetTeam);
    expect(generated.question.length).toBeGreaterThan(0);
    expect(generated.settlementCondition).toEqual({
      targetEventType: generated.targetEventType,
      targetTeam: generated.targetTeam,
      windowStartMinute: 20,
      windowEndMinute: 25,
      resolve: "event_in_window",
    });
  });

  it("tracks substitution counts per team and stops offering that team's substitution once capped", () => {
    const generator = createQuestionGenerator();
    for (let i = 0; i < 5; i++) generator.apply(substitutionEvent("home"));

    const picks = realisticPicks(generator);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "home")).toBe(false);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "away")).toBe(true);
  });

  it("does not attribute an unconfirmed substitution to a team's count", () => {
    const generator = createQuestionGenerator();
    for (let i = 0; i < 5; i++) generator.apply(substitutionEvent("home", false));

    const picks = realisticPicks(generator);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "home")).toBe(true);
  });

  it("does not attribute a team:'any' substitution to either side's count", () => {
    const generator = createQuestionGenerator();
    for (let i = 0; i < 10; i++) generator.apply(substitutionEvent("any"));

    const picks = realisticPicks(generator);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "home")).toBe(true);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "away")).toBe(true);
  });

  it("ignores non-event signals and non-substitution events", () => {
    const generator = createQuestionGenerator();
    generator.apply({ kind: "possession", team: "home", timestamp: "t" });
    generator.apply({
      kind: "event",
      event: { id: "e1", matchId: MATCH_ID, eventType: "shot", team: "home", matchMinute: 10, timestamp: "t", confirmed: true },
    });
    // No throw, and generate() still works normally.
    expect(() => generator.generate(ctx(0))).not.toThrow();
  });

  it("subscribeTo(bus) applies every published signal", () => {
    const bus = new MatchSignalBus();
    const generator = createQuestionGenerator();
    generator.subscribeTo(bus);

    for (let i = 0; i < 5; i++) bus.publish(substitutionEvent("away"));

    const picks = realisticPicks(generator);
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "away")).toBe(false);
  });
});
