// Per-key serialized write queue. The write-through PG stores (pg-prediction-store.ts,
// pg-arena-player-store.ts) and arena-runtime.ts's persistence calls all enqueue their async
// Postgres writes here rather than firing them independently, so that ordered mutations (a
// round's open -> lock -> settle, a player's active -> eliminated/winner transition) always
// persist in the order the engine produced them, never racing to an out-of-order final state.
//
// A failed write is logged at error level and does NOT stop the queue — later writes still run
// in order. This trades "never silently drops data" for "an error is visible in logs, not
// retried automatically"; the queue is the single choke point where a retry/outbox could be
// added later without touching call sites.

import { logger } from "../logger.js";

export class WriteQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Enqueues `write` onto the tail of `key`'s chain (e.g. an arenaId). Returns a promise that
   * resolves once `write` has run (whether it succeeded or was logged as a failure) — callers
   * that want to await persistence (vs. fire-and-forget from a sync engine callback) can `await`
   * it; sync callers can ignore the returned promise.
   */
  enqueue(key: string, write: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(write).catch((err: unknown) => {
      logger.error({ err, key }, "write-queue: persistence write failed");
    });
    this.tails.set(key, next);
    return next;
  }

  /** Waits until every write accepted before this call has completed. */
  async drain(): Promise<void> {
    await Promise.all(this.tails.values());
  }
}
