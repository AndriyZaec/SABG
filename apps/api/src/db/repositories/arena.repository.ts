import { and, eq, sql } from "drizzle-orm";
import type { Arena, ArenaCancelledReason, Uuid, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { arenas } from "../schema.js";
import { arenaRowToEntity } from "../mappers.js";
import { maybeProvisionArena } from "../../onchain/index.js";

const PLACEHOLDER_ESCROW: WalletAddress = "ArEnAEscrowPDA11111111111111111111111111";

export const arenaRepository = {
  async findById(id: Uuid): Promise<Arena | undefined> {
    const [row] = await db.select().from(arenas).where(eq(arenas.id, id));
    return row ? arenaRowToEntity(row) : undefined;
  },

  async findByMatchId(matchId: Uuid): Promise<Arena | undefined> {
    const [row] = await db.select().from(arenas).where(eq(arenas.matchId, matchId));
    return row ? arenaRowToEntity(row) : undefined;
  },

  async listByMatchId(matchId: Uuid): Promise<Arena[]> {
    const rows = await db.select().from(arenas).where(eq(arenas.matchId, matchId));
    return rows.map(arenaRowToEntity);
  },

  async upsertForMatch(
    matchId: Uuid,
    defaults: { entryFeeLamports: number; prizePoolLamports: number },
  ): Promise<Arena> {
    const existing = await this.findByMatchId(matchId);
    if (existing) return existing;

    const [row] = await db
      .insert(arenas)
      .values({
        matchId,
        status: "lobby",
        activePlayersCount: 0,
        entryFeeLamports: defaults.entryFeeLamports,
        prizePoolLamports: defaults.prizePoolLamports,
        escrowAccount: PLACEHOLDER_ESCROW,
        onchainArenaId: null,
      })
      .returning();
    if (!row) throw new Error(`upsertForMatch(${matchId}) returned no row`);
    return arenaRowToEntity(row);
  },

  async ensureOnchain(id: Uuid): Promise<Arena> {
    return db.transaction(async (tx) => {
      // Serialize the shared authority's balance check and spend.
      await tx.execute(sql`select pg_advisory_xact_lock(1397315407, 1)`);
      const [row] = await tx.select().from(arenas).where(eq(arenas.id, id)).for("update");
      if (!row) throw new Error(`Arena ${id} not found during on-chain provisioning`);
      if (row.onchainArenaId != null) return arenaRowToEntity(row);
      if (row.status !== "lobby") throw new Error(`Arena ${id} is no longer in lobby`);

      const onchain = await maybeProvisionArena(row.entryFeeLamports, row.id);
      if (!onchain) return arenaRowToEntity(row);
      const [updated] = await tx
        .update(arenas)
        .set({ escrowAccount: onchain.escrowAccount, onchainArenaId: onchain.onchainArenaId })
        .where(eq(arenas.id, id))
        .returning();
      if (!updated) throw new Error(`Arena ${id} disappeared during on-chain provisioning`);
      return arenaRowToEntity(updated);
    });
  },

  async setStatus(id: Uuid, status: Arena["status"]): Promise<void> {
    await db.update(arenas).set({ status }).where(eq(arenas.id, id));
  },

  async clearCancelledBalances(id: Uuid): Promise<void> {
    await db
      .update(arenas)
      .set({ activePlayersCount: 0, prizePoolLamports: 0 })
      .where(and(eq(arenas.id, id), eq(arenas.status, "cancelled")));
  },

  async cancelIfLobby(id: Uuid, reason: ArenaCancelledReason): Promise<Arena | undefined> {
    const [row] = await db
      .update(arenas)
      .set({ status: "cancelled", cancelledReason: reason })
      .where(and(eq(arenas.id, id), eq(arenas.status, "lobby")))
      .returning();
    return row ? arenaRowToEntity(row) : undefined;
  },

  // Keep increments atomic under concurrent joins.
  async bumpActivePlayers(id: Uuid, delta: number): Promise<void> {
    await db
      .update(arenas)
      .set({ activePlayersCount: sql`${arenas.activePlayersCount} + ${delta}` })
      .where(eq(arenas.id, id));
  },

  // Keep the persisted pool reconciled with escrow under concurrent entries.
  async bumpPrizePool(id: Uuid, delta: number): Promise<void> {
    await db
      .update(arenas)
      .set({ prizePoolLamports: sql`${arenas.prizePoolLamports} + ${delta}` })
      .where(eq(arenas.id, id));
  },
};
