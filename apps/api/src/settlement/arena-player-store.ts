// B4 seam: no ArenaPlayer roster/join API exists yet, so the Settlement Engine depends only on
// this interface (mirrors spec §13 ArenaPlayer). B7/the arena-join flow swaps in a Postgres-backed
// implementation later without the engine changing.

import type { ArenaPlayerStatus, Uuid } from "@arena/contracts";

export interface ArenaPlayerStore {
  /** Player ids still eligible to compete in `arenaId` (spec §8: only active players each round). */
  getActivePlayerIds(arenaId: Uuid): Uuid[];
  /** Updates a player's status after settlement (mirrors ArenaPlayer.status). */
  setStatus(userId: Uuid, status: ArenaPlayerStatus): void;
}

/** In-memory dev/test double. Real persistence lands with the arena-join flow / B7. */
export function createInMemoryArenaPlayerStore(
  arenaId: Uuid,
  initialActivePlayerIds: Uuid[],
): ArenaPlayerStore & { getStatus(userId: Uuid): ArenaPlayerStatus | undefined } {
  const statusByUser = new Map<Uuid, ArenaPlayerStatus>(initialActivePlayerIds.map((id) => [id, "active"]));

  return {
    getActivePlayerIds(queriedArenaId) {
      if (queriedArenaId !== arenaId) return [];
      return [...statusByUser.entries()].filter(([, status]) => status === "active").map(([id]) => id);
    },
    setStatus(userId, status) {
      statusByUser.set(userId, status);
    },
    getStatus(userId) {
      return statusByUser.get(userId);
    },
  };
}
