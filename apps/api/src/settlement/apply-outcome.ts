import type { Answer, ArenaPlayerStatus, PredictionResult, RoundSurvivalRule, Uuid } from "@arena/contracts";
import type { PredictionStore } from "./prediction-store.js";
import type { ArenaPlayerStore } from "./arena-player-store.js";

export interface PlayerResultEvent {
  roundId: Uuid;
  userId: Uuid;
  answer: Answer | undefined;
  result: PredictionResult;
  status: ArenaPlayerStatus;
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
  const survivalRuleApplied = options.noCorrectAnswers === "continue" &&
    activePlayers.some((id) => answers.has(id)) &&
    !activePlayers.some((id) => answers.get(id) === correctAnswer)
    ? "no_correct_answers" : undefined;

  for (const userId of activePlayers) {
    const answer = answers.get(userId);
    const result: PredictionResult = answer === undefined ? "missed" : answer === correctAnswer ? "correct" : "incorrect";
    const status: ArenaPlayerStatus = result === "correct" || (result === "incorrect" && survivalRuleApplied !== undefined)
      ? "active" : "eliminated";

    stores.predictionStore.recordResult(roundId, userId, result);
    stores.arenaPlayerStore.setStatus(userId, status);
    onPlayerResult?.({ roundId, userId, answer, result, status });
  }
  return survivalRuleApplied;
}
