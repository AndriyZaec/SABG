// B7 DAL — arena roster persistence, backing the pg-arena-player-store write-through cache
// (gateway/stores/pg-arena-player-store.ts), which implements settlement/arena-player-store.ts's
// `ArenaPlayerStore` seam for B4.

import { and, eq } from "drizzle-orm";
import type { ArenaPlayer, ArenaPlayerStatus, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { arenaPlayers } from "../schema.js";
import { arenaPlayerRowToEntity } from "../mappers.js";

export const arenaPlayerRepository = {
  /** Join is allowed only pre-kickoff (spec §9) — enforced by the caller (arena-runtime.ts). */
  async join(arenaId: Uuid, userId: Uuid): Promise<ArenaPlayer> {
    const [row] = await db
      .insert(arenaPlayers)
      .values({ arenaId, userId, status: "active", score: 0, joinedAt: new Date() })
      .onConflictDoNothing({ target: [arenaPlayers.arenaId, arenaPlayers.userId] })
      .returning();
    if (row) return arenaPlayerRowToEntity(row);

    // Already joined — return the existing row (idempotent join, e.g. on reconnect).
    const [existing] = await db
      .select()
      .from(arenaPlayers)
      .where(and(eq(arenaPlayers.arenaId, arenaId), eq(arenaPlayers.userId, userId)));
    if (!existing) throw new Error(`join(${arenaId}, ${userId}) found no row after onConflictDoNothing`);
    return arenaPlayerRowToEntity(existing);
  },

  async list(arenaId: Uuid): Promise<ArenaPlayer[]> {
    const rows = await db.select().from(arenaPlayers).where(eq(arenaPlayers.arenaId, arenaId));
    return rows.map(arenaPlayerRowToEntity);
  },

  async getActivePlayerIds(arenaId: Uuid): Promise<Uuid[]> {
    const rows = await db
      .select({ userId: arenaPlayers.userId })
      .from(arenaPlayers)
      .where(and(eq(arenaPlayers.arenaId, arenaId), eq(arenaPlayers.status, "active")));
    return rows.map((r) => r.userId);
  },

  async setStatus(
    arenaId: Uuid,
    userId: Uuid,
    status: ArenaPlayerStatus,
    eliminatedRoundId?: Uuid,
  ): Promise<void> {
    await db
      .update(arenaPlayers)
      .set({ status, ...(eliminatedRoundId !== undefined ? { eliminatedRoundId } : {}) })
      .where(and(eq(arenaPlayers.arenaId, arenaId), eq(arenaPlayers.userId, userId)));
  },
};
