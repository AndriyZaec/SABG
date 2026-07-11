// Prediction (answer) persistence, backing the pg-prediction-store write-through cache,
// which implements settlement/prediction-store.ts's `PredictionStore` seam.

import { and, eq } from "drizzle-orm";
import type { Answer, Prediction, PredictionResult, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { predictions } from "../schema.js";
import { predictionRowToEntity } from "../mappers.js";

export const predictionRepository = {
  /**
   * Upsert on (roundId, userId) so a player can change their answer any number of times before
   * lock (spec §5) — each call re-stamps `receivedAt`, the reconnect tie-break source of truth
   * (spec §9).
   */
  async submitAnswer(roundId: Uuid, userId: Uuid, answer: Answer, receivedAt: Date): Promise<void> {
    await db
      .insert(predictions)
      .values({ roundId, userId, answer, answeredAt: receivedAt, receivedAt })
      .onConflictDoUpdate({
        target: [predictions.roundId, predictions.userId],
        set: { answer, answeredAt: receivedAt, receivedAt },
      });
  },

  async getAnswers(roundId: Uuid): Promise<Map<Uuid, Answer>> {
    const rows = await db
      .select({ userId: predictions.userId, answer: predictions.answer })
      .from(predictions)
      .where(eq(predictions.roundId, roundId));
    return new Map(rows.map((r) => [r.userId, r.answer]));
  },

  async recordResult(roundId: Uuid, userId: Uuid, result: PredictionResult): Promise<void> {
    await db
      .update(predictions)
      .set({ result })
      .where(and(eq(predictions.roundId, roundId), eq(predictions.userId, userId)));
  },

  /**
   * GET /arenas/:id/rounds (history) — every player's full Prediction row for a round. Callers
   * must only surface this for settled rounds (spec §8: individual answers are never revealed
   * before settle) — this repository method itself has no notion of round status, so that gate
   * belongs to the caller (rest.ts).
   */
  async listByRoundId(roundId: Uuid): Promise<Prediction[]> {
    const rows = await db.select().from(predictions).where(eq(predictions.roundId, roundId));
    return rows.map(predictionRowToEntity);
  },
};
