// B7 DAL — PredictionRound persistence. `upsert` is called from arena-runtime.ts on every B3/B4
// lifecycle transition (open/lock/settle) with the full current round shape, so one write path
// covers create-on-open and update-on-lock/settle.

import { eq } from "drizzle-orm";
import type { PredictionRound, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { predictionRounds } from "../schema.js";
import { predictionRoundRowToEntity } from "../mappers.js";

function toDate(iso: string | undefined): Date | undefined {
  return iso === undefined ? undefined : new Date(iso);
}

export const predictionRoundRepository = {
  async upsert(round: PredictionRound): Promise<PredictionRound> {
    const values = {
      id: round.id,
      arenaId: round.arenaId,
      matchId: round.matchId,
      windowStartMinute: round.windowStartMinute,
      windowEndMinute: round.windowEndMinute,
      question: round.question,
      targetEventType: round.targetEventType,
      targetTeam: round.targetTeam,
      settlementCondition: round.settlementCondition,
      status: round.status,
      correctAnswer: round.correctAnswer ?? null,
      openedAt: toDate(round.openedAt) ?? null,
      lockedAt: toDate(round.lockedAt) ?? null,
      settledAt: toDate(round.settledAt) ?? null,
      settledBy: round.settledBy ?? null,
    };

    const [row] = await db
      .insert(predictionRounds)
      .values(values)
      .onConflictDoUpdate({ target: predictionRounds.id, set: values })
      .returning();
    if (!row) throw new Error(`upsert(round ${round.id}) returned no row`);
    return predictionRoundRowToEntity(row);
  },

  async findById(id: Uuid): Promise<PredictionRound | undefined> {
    const [row] = await db.select().from(predictionRounds).where(eq(predictionRounds.id, id));
    return row ? predictionRoundRowToEntity(row) : undefined;
  },

  /** GET /arenas/:id/rounds (history) — every round created for the arena, in window order. */
  async listByArenaId(arenaId: Uuid): Promise<PredictionRound[]> {
    const rows = await db
      .select()
      .from(predictionRounds)
      .where(eq(predictionRounds.arenaId, arenaId))
      .orderBy(predictionRounds.windowStartMinute);
    return rows.map(predictionRoundRowToEntity);
  },
};
