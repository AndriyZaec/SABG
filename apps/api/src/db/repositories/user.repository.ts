// B7 DAL — user persistence. `upsertByWallet` backs POST /auth/wallet (gateway/auth.ts): a wallet
// address always maps to the same User row, created on first sign-in.

import { eq } from "drizzle-orm";
import type { User, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { users } from "../schema.js";
import { userRowToEntity } from "../mappers.js";

export const userRepository = {
  async upsertByWallet(walletAddress: WalletAddress, username: string): Promise<User> {
    const [row] = await db
      .insert(users)
      .values({ walletAddress, username })
      .onConflictDoUpdate({
        target: users.walletAddress,
        // Keep the existing username on repeat sign-in — only wallet identity is upserted.
        set: { walletAddress },
      })
      .returning();
    if (!row) throw new Error(`upsertByWallet(${walletAddress}) returned no row`);
    return userRowToEntity(row);
  },

  async findById(id: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row ? userRowToEntity(row) : undefined;
  },
};
