// B7 — Postgres-backed PredictionStore (settlement/prediction-store.ts's B4 seam). The interface
// is synchronous (called inside SettlementEngine's sync signal handling), but Postgres writes are
// async — so this is a write-through cache: an in-memory Map is the synchronous source of truth,
// hydrated per round, and every mutation both updates the cache immediately and enqueues a
// Postgres mirror write on the shared per-arena WriteQueue (ordered, error-logged on failure; see
// write-queue.ts). Reads never wait on Postgres.

import type { Answer, PredictionResult, Uuid } from "@arena/contracts";
import type { PredictionStore } from "../../settlement/prediction-store.js";
import { predictionRepository } from "../../db/repositories/prediction.repository.js";
import type { WriteQueue } from "./write-queue.js";

export interface PgPredictionStore extends PredictionStore {
  /** Preloads the answer cache for a round (e.g. on gateway restart / arena resume). */
  hydrate(roundId: Uuid, answers: ReadonlyMap<Uuid, Answer>): void;
  /**
   * Records/changes a player's answer (REST POST /rounds/:id/answer or the WS `answer` message,
   * both funnel through arena-runtime.ts's `submitAnswer`). `receivedAt` is the server receive
   * time — authoritative for the reconnect tie-break (spec §9) and is what gets persisted.
   */
  recordAnswer(roundId: Uuid, userId: Uuid, answer: Answer, receivedAt: Date): void;
  getResult(roundId: Uuid, userId: Uuid): PredictionResult | undefined;
}

export function createPgPredictionStore(arenaId: Uuid, writeQueue: WriteQueue): PgPredictionStore {
  const answersByRound = new Map<Uuid, Map<Uuid, Answer>>();
  const resultsByRound = new Map<Uuid, Map<Uuid, PredictionResult>>();

  function answersFor(roundId: Uuid): Map<Uuid, Answer> {
    let answers = answersByRound.get(roundId);
    if (answers === undefined) {
      answers = new Map();
      answersByRound.set(roundId, answers);
    }
    return answers;
  }

  return {
    hydrate(roundId, answers) {
      answersByRound.set(roundId, new Map(answers));
    },

    getAnswers(roundId) {
      return answersByRound.get(roundId) ?? new Map();
    },

    recordAnswer(roundId, userId, answer, receivedAt) {
      answersFor(roundId).set(userId, answer);
      void writeQueue.enqueue(arenaId, () => predictionRepository.submitAnswer(roundId, userId, answer, receivedAt));
    },

    recordResult(roundId, userId, result) {
      let results = resultsByRound.get(roundId);
      if (results === undefined) {
        results = new Map();
        resultsByRound.set(roundId, results);
      }
      results.set(userId, result);
      void writeQueue.enqueue(arenaId, () => predictionRepository.recordResult(roundId, userId, result));
    },

    getResult(roundId, userId) {
      return resultsByRound.get(roundId)?.get(userId);
    },
  };
}
