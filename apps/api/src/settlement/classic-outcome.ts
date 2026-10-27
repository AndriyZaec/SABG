import { cs2ClassicRoundPoints, cs2ClassicZoneAfter } from "@arena/contracts";
import type { Answer, ArenaPlayerStatus, ArenaStage, PredictionResult, RoundSurvivalRule, Uuid } from "@arena/contracts";
import { hardcoreStatus, noCorrectAnswersRule, predictionResult } from "./apply-outcome.js";

export interface ClassicRoundInput {
  roundNumber: number;
  /** Stage before this round. */
  stage: ArenaStage;
  /** Active players with their score before this round. */
  players: readonly { userId: Uuid; score: number }[];
  answers: ReadonlyMap<Uuid, Answer>;
  correctAnswer: Answer;
}

export interface ClassicPlayerResult {
  userId: Uuid;
  answer: Answer | undefined;
  result: PredictionResult;
  points: number;
  status: ArenaPlayerStatus;
}

export interface ClassicRoundOutcome {
  results: ClassicPlayerResult[];
  /** Stage after this round. */
  stage: ArenaStage;
  survivalRuleApplied?: RoundSurvivalRule;
}

/** Pure classic settlement: points and the zone, or hardcore rules once the arena is in Final Circle. */
export function resolveClassicRound(input: ClassicRoundInput): ClassicRoundOutcome {
  return input.stage === "final_circle" ? resolveFinalCircleRound(input) : resolveZoneRound(input);
}

function resolveZoneRound({ roundNumber, players, answers, correctAnswer }: ClassicRoundInput): ClassicRoundOutcome {
  const zone = cs2ClassicZoneAfter(roundNumber);
  const scored = players.map(({ userId, score }) => {
    const answer = answers.get(userId);
    const result = predictionResult(answer, correctAnswer);
    const points = result === "correct" ? cs2ClassicRoundPoints(roundNumber) : 0;
    return { userId, answer, result, points, scoreAfter: score + points };
  });

  const anyAboveZone = scored.some((p) => p.scoreAfter >= zone);
  // The zone would empty the field: the top scorers survive instead.
  const threshold = anyAboveZone || scored.length === 0 ? zone : Math.max(...scored.map((p) => p.scoreAfter));
  const results = scored.map(({ scoreAfter, ...rest }): ClassicPlayerResult => ({
    ...rest,
    status: scoreAfter >= threshold ? "active" : "eliminated",
  }));

  const survivors = results.filter((r) => r.status === "active").length;
  return { results, stage: !anyAboveZone && survivors >= 2 ? "final_circle" : "zone" };
}

function resolveFinalCircleRound({ players, answers, correctAnswer }: ClassicRoundInput): ClassicRoundOutcome {
  const survivalRuleApplied = noCorrectAnswersRule(players.map((p) => p.userId), answers, correctAnswer);
  const results = players.map(({ userId }): ClassicPlayerResult => {
    const answer = answers.get(userId);
    const result = predictionResult(answer, correctAnswer);
    return { userId, answer, result, points: result === "correct" ? 1 : 0, status: hardcoreStatus(result, survivalRuleApplied) };
  });
  return { results, stage: "final_circle", ...(survivalRuleApplied !== undefined ? { survivalRuleApplied } : {}) };
}
