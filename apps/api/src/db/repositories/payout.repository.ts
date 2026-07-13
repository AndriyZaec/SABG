// Payout persistence — one row per winner per arena. Created `pending`, then marked
// `sent` (with the settle tx signature) or `failed` by the payout service.

import { eq } from "drizzle-orm";
import type { Payout, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { payouts } from "../schema.js";
import { payoutRowToEntity } from "../mappers.js";

export const payoutRepository = {
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

  async markSent(id: Uuid, txSignature: string): Promise<void> {
    await db.update(payouts).set({ status: "sent", txSignature }).where(eq(payouts.id, id));
  },

  async markFailed(id: Uuid): Promise<void> {
    await db.update(payouts).set({ status: "failed" }).where(eq(payouts.id, id));
  },

  async listByArena(arenaId: Uuid): Promise<Payout[]> {
    const rows = await db.select().from(payouts).where(eq(payouts.arenaId, arenaId));
    return rows.map(payoutRowToEntity);
  },
};
