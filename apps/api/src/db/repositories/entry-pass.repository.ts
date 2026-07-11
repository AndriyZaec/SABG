// EntryPass persistence, backing POST /arenas/:id/entry. Records the client-reported
// on-chain tx signature without chain verification (out of scope here — see the plan's
// non-goals).

import type { EntryPass, Uuid, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { entryPasses } from "../schema.js";
import { entryPassRowToEntity } from "../mappers.js";

export const entryPassRepository = {
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
