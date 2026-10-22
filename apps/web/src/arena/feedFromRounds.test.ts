import { describe, expect, it } from "vitest";
import type { PredictionResult, RoundWithPredictions } from "@arena/contracts";
import { CLASSIC_CORRECT_TEXT, CLASSIC_NO_POINTS_TEXT, ELIMINATED_TEXT, feedFromRounds } from "./feedFromRounds.js";

function settledRound(n: number, result: PredictionResult): RoundWithPredictions {
  return {
    round: {
      id: `r${n}`,
      arenaId: "a1",
      matchId: "m1",
      discipline: "cs2",
      roundNumber: n,
      question: `Q${n}`,
      settlementCondition: { discipline: "cs2", topic: "round_winner", params: {}, roundNumber: n, resolve: "snapshot_diff" },
      status: "settled",
      correctAnswer: "yes",
      settledAt: `2026-10-22T10:0${n}:00.000Z`,
    },
    predictions: [{
      id: `p${n}`, roundId: `r${n}`, userId: "me", answer: result === "correct" ? "yes" : "no",
      answeredAt: "2026-10-22T10:00:00.000Z", receivedAt: "2026-10-22T10:00:00.000Z", result,
    }],
  };
}

const personal = (feed: ReturnType<typeof feedFromRounds>) => feed.filter((item) => item.id.startsWith("me-"));

describe("feedFromRounds", () => {
  const rounds = [settledRound(1, "correct"), settledRound(2, "incorrect")];

  it("treats a wrong answer as elimination in hardcore", () => {
    expect(personal(feedFromRounds(rounds, "me")).map((item) => item.text)).toContain(ELIMINATED_TEXT);
  });

  it("reports points, not eliminations, in classic", () => {
    expect(personal(feedFromRounds(rounds, "me", "classic"))).toEqual([
      { id: "me-r2", kind: "info", text: CLASSIC_NO_POINTS_TEXT },
      { id: "me-r1", kind: "survived", text: CLASSIC_CORRECT_TEXT },
    ]);
  });
});
