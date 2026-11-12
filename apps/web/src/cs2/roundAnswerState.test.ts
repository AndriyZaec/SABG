import { describe, expect, it } from "vitest";
import type { Cs2RoundView } from "./cs2View.js";
import { roundAnswerState } from "./roundAnswerState.js";

const ROUND: Cs2RoundView = { roundId: "r7", roundNumber: 7, question: "Did Team A win round 7?", status: "open", myAnswer: "no" };

describe("roundAnswerState", () => {
  it("shows the in-flight choice only for the current round", () => {
    expect(roundAnswerState(ROUND, { status: "submitting", roundId: "r7", answer: "yes" }, false))
      .toMatchObject({ picked: "yes", submitting: true });
    expect(roundAnswerState(ROUND, { status: "submitting", roundId: "r6", answer: "yes" }, false))
      .toMatchObject({ picked: "no", submitting: false, currentSubmission: undefined });
  });

  it("keeps the authoritative answer after acceptance or rejection", () => {
    expect(roundAnswerState(ROUND, { status: "accepted", roundId: "r7", answer: "yes" }, false).picked).toBe("no");
    const rejected = { status: "rejected", roundId: "r7", answer: "yes", reason: "round_locked" } as const;
    expect(roundAnswerState(ROUND, rejected, false)).toMatchObject({ picked: "no", currentSubmission: rejected });
  });

  it("distinguishes a correct answer, rescue and authoritative elimination", () => {
    const settled: Cs2RoundView = { ...ROUND, status: "settled", correctAnswer: "yes" };
    expect(roundAnswerState(settled, { status: "idle" }, false)).toMatchObject({ correct: false, survived: false });
    expect(roundAnswerState({ ...settled, survivalRuleApplied: "no_correct_answers" }, { status: "idle" }, false))
      .toMatchObject({ correct: false, survived: true });
    expect(roundAnswerState({ ...settled, myAnswer: "yes" }, { status: "idle" }, true))
      .toMatchObject({ correct: true, survived: false });
    expect(roundAnswerState({ ...settled, myAnswer: undefined, survivalRuleApplied: "no_correct_answers" }, { status: "idle" }, false).survived)
      .toBe(false);
  });
});
