import { and, eq, inArray, sql } from "drizzle-orm";
import type { Payout, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { payouts } from "../schema.js";
import { payoutRowToEntity } from "../mappers.js";

export const payoutRepository = {
  /** Lamports actually sent per user across the given arenas. */
  async sentTotalsByUser(arenaIds: readonly Uuid[]): Promise<Map<Uuid, number>> {
    if (arenaIds.length === 0) return new Map();
    const rows = await db
      .select({ userId: payouts.userId, total: sql<number>`sum(${payouts.amountLamports})`.mapWith(Number) })
      .from(payouts)
      .where(and(inArray(payouts.arenaId, [...arenaIds]), eq(payouts.status, "sent")))
      .groupBy(payouts.userId);
    return new Map(rows.map((row) => [row.userId, row.total]));
  },

  async create(input: { arenaId: Uuid; userId: Uuid; amountLamports: number }): Promise<Payout> {
    const [row] = await db
      .insert(payouts)
      .values({
        arenaId: input.arenaId,
        userId: input.userId,
        amountLamports: input.amountLamports,
        status: "pending",
      })
      .returning();
    if (!row) throw new Error(`payoutRepository.create(${input.arenaId}, ${input.userId}) returned no row`);
    return payoutRowToEntity(row);
  },

  async markSent(id: Uuid, txSignature?: string): Promise<void> {
    await db
      .update(payouts)
      .set(txSignature === undefined ? { status: "sent" } : { status: "sent", txSignature })
      .where(eq(payouts.id, id));
  },

  async delete(id: Uuid): Promise<void> {
    await db.delete(payouts).where(eq(payouts.id, id));
  },

  async markFailed(id: Uuid): Promise<void> {
    await db.update(payouts).set({ status: "failed" }).where(eq(payouts.id, id));
  },

  async listByArena(arenaId: Uuid): Promise<Payout[]> {
    const rows = await db.select().from(payouts).where(eq(payouts.arenaId, arenaId));
    return rows.map(payoutRowToEntity);
  },
};
