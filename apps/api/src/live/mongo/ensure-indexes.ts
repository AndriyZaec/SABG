// Trimmed port of world-cup's services/mongo.indexes.ts — only the stream-events indexes
// (this port doesn't bring over the polling path's raw_events/match_events/score_snapshot
// collections).

import { MongoService } from "./mongo.service.js";
import { logger } from "../logger.js";
import { STREAM_EVENTS_COLLECTION } from "./stream-event.repository.js";

/**
 * Idempotent index bootstrap for the live stream store. Safe to call on every startup —
 * `createIndex` is a no-op when the target already matches.
 */
export async function ensureIndexes(): Promise<void> {
  const db = await MongoService.getDb();
  const streamEventsColl = db.collection(STREAM_EVENTS_COLLECTION);

  // Ordering key AND idempotency guard: the same Seq re-arriving at a reconnect boundary
  // must be a no-op, never a duplicate row.
  await streamEventsColl.createIndex({ fixtureId: 1, seq: 1 }, { unique: true });
  await streamEventsColl.createIndex({ fixtureId: 1, ts: 1 });

  logger.info({ collection: STREAM_EVENTS_COLLECTION }, "MongoDB indexes ensured");
}
