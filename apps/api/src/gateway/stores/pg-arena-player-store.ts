// Postgres-backed ArenaPlayerStore (settlement/arena-player-store.ts's seam). Same
// write-through-cache shape as pg-prediction-store.ts: a synchronous in-memory status map backs
// the engine-facing interface, hydrated on load, mutated immediately, and mirrored to Postgres
// through the shared per-arena WriteQueue.

import type { ArenaPlayerStatus, Uuid } from "@arena/contracts";
import type { ArenaPlayerStore } from "../../settlement/arena-player-store.js";
import { arenaPlayerRepository } from "../../db/repositories/arena-player.repository.js";
import type { WriteQueue } from "./write-queue.js";

export interface PgArenaPlayerStore extends ArenaPlayerStore {
  /** Preloads the roster status cache (e.g. on gateway restart / arena resume). */
  hydrate(players: ReadonlyArray<{ userId: Uuid; status: ArenaPlayerStatus }>): void;
  /** Adds a newly-joined player (spec §9: join only pre-kickoff, enforced by the caller). */
  addPlayer(userId: Uuid): void;
  getStatus(userId: Uuid): ArenaPlayerStatus | undefined;
}

export function createPgArenaPlayerStore(arenaId: Uuid, writeQueue: WriteQueue): PgArenaPlayerStore {
  const statusByUser = new Map<Uuid, ArenaPlayerStatus>();

  return {
    hydrate(players) {
      for (const { userId, status } of players) statusByUser.set(userId, status);
    },

    addPlayer(userId) {
      statusByUser.set(userId, "active");
      void writeQueue.enqueue(arenaId, () => arenaPlayerRepository.join(arenaId, userId).then(() => undefined));
    },

    getActivePlayerIds(queriedArenaId) {
      if (queriedArenaId !== arenaId) return [];
      return [...statusByUser.entries()].filter(([, status]) => status === "active").map(([id]) => id);
    },

    setStatus(userId, status) {
      statusByUser.set(userId, status);
      void writeQueue.enqueue(arenaId, () => arenaPlayerRepository.setStatus(arenaId, userId, status));
    },

    getStatus(userId) {
      return statusByUser.get(userId);
    },
  };
}
