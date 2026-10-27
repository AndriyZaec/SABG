import { describe, expect, it } from "vitest";
import type { Answer, ArenaStage, Uuid } from "@arena/contracts";
import { resolveClassicRound } from "../classic-outcome.js";

/** players: [userId, scoreBefore, answer] — undefined answer means missed; the correct answer is always "yes". */
function round(roundNumber: number, players: Array<[Uuid, number, Answer | undefined]>, stage: ArenaStage = "zone") {
  const answers = new Map<Uuid, Answer>();
  for (const [userId, , answer] of players) if (answer !== undefined) answers.set(userId, answer);
  return resolveClassicRound({
    roundNumber,
    stage,
    players: players.map(([userId, score]) => ({ userId, score })),
    answers,
    correctAnswer: "yes",
  });
}

function byUser(outcome: ReturnType<typeof resolveClassicRound>, userId: Uuid) {
  return outcome.results.find((r) => r.userId === userId);
}

describe("resolveClassicRound — zone stage", () => {
  it("gives 2 points on round 1 and 1 on round 2; wrong and missed give 0 and nobody falls in the warm-up", () => {
    const r1 = round(1, [["a", 0, "yes"], ["b", 0, "no"], ["c", 0, undefined]]);
    expect(r1.results).toEqual([
      { userId: "a", answer: "yes", result: "correct", points: 2, status: "active" },
      { userId: "b", answer: "no", result: "incorrect", points: 0, status: "active" },
      { userId: "c", answer: undefined, result: "missed", points: 0, status: "active" },
    ]);
    expect(r1.stage).toBe("zone");
    expect(byUser(round(2, [["a", 0, "yes"], ["b", 0, "no"]]), "a")?.points).toBe(1);
    expect(round(5, [["a", 0, "no"], ["b", 0, undefined]]).results.every((r) => r.status === "active")).toBe(true);
  });

  it("eliminates only players strictly below the zone (zone after R8 = 4)", () => {
    const outcome = round(8, [["below", 3, "no"], ["onZone", 4, "no"], ["above", 4, "yes"]]);
    expect(byUser(outcome, "below")?.status).toBe("eliminated");
    expect(byUser(outcome, "onZone")?.status).toBe("active");
    expect(byUser(outcome, "above")?.status).toBe("active");
    expect(outcome.stage).toBe("zone");
    expect(outcome).not.toHaveProperty("survivalRuleApplied");
  });

  it("when the zone would empty the field, the tied top scorers survive and Final Circle starts", () => {
    // Zone after R13 = 9; R13 is a double round.
    const outcome = round(13, [["a", 5, "no"], ["b", 3, "yes"], ["c", 3, "no"]]);
    expect(outcome.results.map((r) => [r.userId, r.status])).toEqual([
      ["a", "active"], ["b", "active"], ["c", "eliminated"],
    ]);
    expect(outcome.stage).toBe("final_circle");
  });

  it("when the zone would empty the field with one top scorer, only they survive and the stage stays zone", () => {
    const outcome = round(13, [["a", 6, "no"], ["b", 5, "no"], ["c", 3, "no"]]);
    expect(outcome.results.map((r) => [r.userId, r.status])).toEqual([
      ["a", "active"], ["b", "eliminated"], ["c", "eliminated"],
    ]);
    expect(outcome.stage).toBe("zone");
  });

  it("gives 1 point for a correct answer in overtime (R25)", () => {
    expect(byUser(round(25, [["a", 30, "yes"]]), "a")?.points).toBe(1);
  });

  it("returns no results and keeps the stage for an empty field", () => {
    expect(round(8, [])).toEqual({ results: [], stage: "zone" });
  });
});

describe("resolveClassicRound — Final Circle", () => {
  it("eliminates wrong and missed answers, ignores the zone and gives 1 point even on a double round", () => {
    const outcome = round(24, [["a", 1, "yes"], ["b", 30, "no"], ["c", 30, undefined]], "final_circle");
    expect(outcome.results).toEqual([
      { userId: "a", answer: "yes", result: "correct", points: 1, status: "active" },
      { userId: "b", answer: "no", result: "incorrect", points: 0, status: "eliminated" },
      { userId: "c", answer: undefined, result: "missed", points: 0, status: "eliminated" },
    ]);
    expect(outcome.stage).toBe("final_circle");
    expect(outcome).not.toHaveProperty("survivalRuleApplied");
  });

  it("keeps incorrect answerers when nobody answered correctly; missed still eliminates", () => {
    const outcome = round(20, [["a", 9, "no"], ["b", 9, "no"], ["c", 9, undefined]], "final_circle");
    expect(outcome.results.map((r) => [r.userId, r.status])).toEqual([
      ["a", "active"], ["b", "active"], ["c", "eliminated"],
    ]);
    expect(outcome.survivalRuleApplied).toBe("no_correct_answers");
  });
});
