import type { Answer, ArenaPlayerStatus, PredictionResult, Uuid } from "@arena/contracts";
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
): void {
  const answers = stores.predictionStore.getAnswers(roundId);

  for (const userId of stores.arenaPlayerStore.getActivePlayerIds(arenaId)) {
    const answer = answers.get(userId);
    const result: PredictionResult = answer === undefined ? "missed" : answer === correctAnswer ? "correct" : "incorrect";
    const status: ArenaPlayerStatus = result === "correct" ? "active" : "eliminated";

    stores.predictionStore.recordResult(roundId, userId, result);
    stores.arenaPlayerStore.setStatus(userId, status);
    onPlayerResult?.({ roundId, userId, answer, result, status });
  }
}
