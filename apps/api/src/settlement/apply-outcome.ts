import type { Answer, ArenaPlayerStatus, PredictionResult, RoundSurvivalRule, Uuid } from "@arena/contracts";
import type { PredictionStore } from "./prediction-store.js";
import type { ArenaPlayerStore } from "./arena-player-store.js";

export interface PlayerResultEvent {
  roundId: Uuid;
  userId: Uuid;
  answer: Answer | undefined;
  result: PredictionResult;
  /** What this result adds to the player's score. */
  points: number;
  status: ArenaPlayerStatus;
}

export function predictionResult(answer: Answer | undefined, correctAnswer: Answer): PredictionResult {
  return answer === undefined ? "missed" : answer === correctAnswer ? "correct" : "incorrect";
}

/** Someone answered but nobody got it right: incorrect answerers survive the round. */
export function noCorrectAnswersRule(
  playerIds: readonly Uuid[],
  answers: ReadonlyMap<Uuid, Answer>,
  correctAnswer: Answer,
): RoundSurvivalRule | undefined {
  return playerIds.some((id) => answers.has(id)) && !playerIds.some((id) => answers.get(id) === correctAnswer)
    ? "no_correct_answers" : undefined;
}

/** Hardcore elimination: anything but a correct answer eliminates, unless the survival rule applied. */
export function hardcoreStatus(result: PredictionResult, survivalRuleApplied: RoundSurvivalRule | undefined): ArenaPlayerStatus {
  return result === "correct" || (result === "incorrect" && survivalRuleApplied !== undefined) ? "active" : "eliminated";
}

export function applyRoundOutcome(
  roundId: Uuid,
  arenaId: Uuid,
  correctAnswer: Answer,
  stores: { predictionStore: PredictionStore; arenaPlayerStore: ArenaPlayerStore },
  onPlayerResult?: (event: PlayerResultEvent) => void,
  options: { noCorrectAnswers?: "continue" } = {},
): RoundSurvivalRule | undefined {
  const answers = stores.predictionStore.getAnswers(roundId);
  const activePlayers = stores.arenaPlayerStore.getActivePlayerIds(arenaId);
  const survivalRuleApplied = options.noCorrectAnswers === "continue"
    ? noCorrectAnswersRule(activePlayers, answers, correctAnswer) : undefined;

  for (const userId of activePlayers) {
    const answer = answers.get(userId);
    const result = predictionResult(answer, correctAnswer);
    const status = hardcoreStatus(result, survivalRuleApplied);

    stores.predictionStore.recordResult(roundId, userId, result);
    stores.arenaPlayerStore.setStatus(userId, status);
    onPlayerResult?.({ roundId, userId, answer, result, points: result === "correct" ? 1 : 0, status });
  }
  return survivalRuleApplied;
}
