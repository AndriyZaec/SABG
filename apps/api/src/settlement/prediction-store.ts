// B4 seam: B7's real answer-submission API (POST /rounds/:id/answer) doesn't exist yet, so the
// Settlement Engine depends only on this interface (mirrors spec §13 Prediction). B7 swaps in a
// Postgres-backed implementation later without the engine changing.

import type { Answer, PredictionResult, Uuid } from "@arena/contracts";

export interface PredictionStore {
  /** Answers submitted for a round so far, keyed by userId. */
  getAnswers(roundId: Uuid): ReadonlyMap<Uuid, Answer>;
  /** Records the settlement outcome for one user's prediction (mirrors Prediction.result). */
  recordResult(roundId: Uuid, userId: Uuid, result: PredictionResult): void;
}

/** In-memory dev/test double. Real persistence lands with B7. */
export function createInMemoryPredictionStore(): PredictionStore & {
  recordAnswer(roundId: Uuid, userId: Uuid, answer: Answer): void;
  getResult(roundId: Uuid, userId: Uuid): PredictionResult | undefined;
} {
  const answersByRound = new Map<Uuid, Map<Uuid, Answer>>();
  const resultsByRound = new Map<Uuid, Map<Uuid, PredictionResult>>();

  return {
    getAnswers(roundId) {
      return answersByRound.get(roundId) ?? new Map();
    },
    recordResult(roundId, userId, result) {
      let results = resultsByRound.get(roundId);
      if (results === undefined) {
        results = new Map();
        resultsByRound.set(roundId, results);
      }
      results.set(userId, result);
    },
    recordAnswer(roundId, userId, answer) {
      let answers = answersByRound.get(roundId);
      if (answers === undefined) {
        answers = new Map();
        answersByRound.set(roundId, answers);
      }
      answers.set(userId, answer);
    },
    getResult(roundId, userId) {
      return resultsByRound.get(roundId)?.get(userId);
    },
  };
}
