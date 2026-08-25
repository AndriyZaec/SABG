import { and, eq } from "drizzle-orm";
import type { EntryPass, Uuid, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { entryPasses } from "../schema.js";
import { entryPassRowToEntity } from "../mappers.js";

export const entryPassRepository = {
  async findByArenaAndUser(arenaId: Uuid, userId: Uuid): Promise<EntryPass | undefined> {
    const [row] = await db
      .select()
      .from(entryPasses)
      .where(and(eq(entryPasses.arenaId, arenaId), eq(entryPasses.userId, userId)));
    return row ? entryPassRowToEntity(row) : undefined;
  },

  async create(input: {
    arenaId: Uuid;
    userId: Uuid;
    walletAddress: WalletAddress;
    amountLamports: number;
    txSignature: string;
  }): Promise<EntryPass> {
    const [row] = await db
      .insert(entryPasses)
      .values({
        arenaId: input.arenaId,
        userId: input.userId,
        walletAddress: input.walletAddress,
        amountLamports: input.amountLamports,
        txSignature: input.txSignature,
        status: "paid",
        purchasedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error(`entryPassRepository.create(${input.arenaId}, ${input.userId}) returned no row`);
    return entryPassRowToEntity(row);
  },

  // Include refunded rows so reconciliation sees the complete payment history.
  async listByArenaId(arenaId: Uuid): Promise<EntryPass[]> {
    const rows = await db.select().from(entryPasses).where(eq(entryPasses.arenaId, arenaId));
    return rows.map(entryPassRowToEntity);
  },

  // Mark refunded only after chain finalization or successful reconciliation.
  async markRefunded(id: Uuid): Promise<EntryPass> {
    const [row] = await db.update(entryPasses).set({ status: "refunded" }).where(eq(entryPasses.id, id)).returning();
    if (!row) throw new Error(`entryPassRepository.markRefunded(${id}) returned no row`);
    return entryPassRowToEntity(row);
  },
};
