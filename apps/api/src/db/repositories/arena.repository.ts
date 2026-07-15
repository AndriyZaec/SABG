import { eq, sql } from "drizzle-orm";
import type { Arena, Uuid, WalletAddress } from "@arena/contracts";
import { db } from "../client.js";
import { arenas } from "../schema.js";
import { arenaRowToEntity } from "../mappers.js";
import { maybeProvisionArena } from "../../onchain/index.js";

/** Devnet-only placeholder escrow address until the on-chain program mints a real PDA per arena. */
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

  /**
   * GET /arenas?matchId= (lobby discovery). The schema has no uniqueness constraint on
   * matchId, so this is a genuine list query, not just `findByMatchId` wrapped in an array —
   * today's demo bootstrap only ever creates one arena per match, but the query doesn't assume it.
   */
  async listByMatchId(matchId: Uuid): Promise<Arena[]> {
    const rows = await db.select().from(arenas).where(eq(arenas.matchId, matchId));
    return rows.map(arenaRowToEntity);
  },

  /**
   * Idempotent demo bootstrap (gateway/run.ts): one arena per match, created in `lobby` on first
   * boot and reused thereafter.
   */
  async upsertForMatch(
    matchId: Uuid,
    defaults: { entryFeeLamports: number; prizePoolLamports: number },
  ): Promise<Arena> {
    const existing = await this.findByMatchId(matchId);
    if (existing) return existing;

    // Real escrow + on-chain id when provisioning is enabled; placeholder otherwise (demo path).
    const onchain = await maybeProvisionArena(defaults.entryFeeLamports);

    const [row] = await db
      .insert(arenas)
      .values({
        matchId,
        status: "lobby",
        activePlayersCount: 0,
        entryFeeLamports: defaults.entryFeeLamports,
        prizePoolLamports: defaults.prizePoolLamports,
        escrowAccount: onchain?.escrowAccount ?? PLACEHOLDER_ESCROW,
        onchainArenaId: onchain?.onchainArenaId ?? null,
      })
      .returning();
    if (!row) throw new Error(`upsertForMatch(${matchId}) returned no row`);
    return arenaRowToEntity(row);
  },

  async setStatus(id: Uuid, status: Arena["status"]): Promise<void> {
    await db.update(arenas).set({ status }).where(eq(arenas.id, id));
  },

  /** Called on entry purchase (POST /arenas/:id/entry) and on join. Atomic increment — avoids a
   *  read-then-write race under concurrent joins. */
  async bumpActivePlayers(id: Uuid, delta: number): Promise<void> {
    await db
      .update(arenas)
      .set({ activePlayersCount: sql`${arenas.activePlayersCount} + ${delta}` })
      .where(eq(arenas.id, id));
  },

  /** Called on entry purchase alongside bumpActivePlayers. Atomic increment mirrors the on-chain
   *  program's `arena.prize_pool_lamports += fee`, keeping the DB pool in sync with escrow. */
  async bumpPrizePool(id: Uuid, delta: number): Promise<void> {
    await db
      .update(arenas)
      .set({ prizePoolLamports: sql`${arenas.prizePoolLamports} + ${delta}` })
      .where(eq(arenas.id, id));
  },
};
