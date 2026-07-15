// EntryPass persistence, backing POST /arenas/:id/entry. Records the client-reported
// on-chain tx signature without chain verification (out of scope here — see the plan's
// non-goals).

import { and, eq } from "drizzle-orm";
import type { EntryPass, Uuid, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { entryPasses } from "../schema.js";
import { entryPassRowToEntity } from "../mappers.js";

export const entryPassRepository = {
  /** For callers that need to check "already entered" before `create` (e.g. an idempotent demo bootstrap). */
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
};
