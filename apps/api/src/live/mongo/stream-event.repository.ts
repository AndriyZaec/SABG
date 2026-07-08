// Ported from world-cup's repositories/stream-event.repository.ts, retargeted to this
// project's own ScoreSnapshot type (../../ingestion/score-snapshot.js) and a dedicated
// collection name.

import type { Collection, Document } from "mongodb";
import { MongoService } from "./mongo.service.js";
import { withRetry } from "../retry.js";
import { logger } from "../logger.js";
import { DatabaseError } from "../errors.js";
import type { ScoreSnapshot } from "../../ingestion/score-snapshot.js";

export const STREAM_EVENTS_COLLECTION = "live_stream_events";

/** One document per score message received over the real-time `/scores/stream` SSE feed. */
export interface StreamEventDoc {
  fixtureId: number;
  seq: number;
  eventId?: string | undefined; // SSE `id:` field (`timestamp:index`), used to resume via Last-Event-ID
  actionId?: number | undefined;
  action?: string | undefined;
  statusId?: number | undefined;
  ts: Date;
  receivedAt: Date;
  payload: ScoreSnapshot;
}

/**
 * Durable store for the real-time `/scores/stream` SSE feed of one fixture. `Seq` is the
 * canonical ordering key and — via the unique `{fixtureId, seq}` index — the idempotency
 * guard: a frame replayed after a reconnect is a no-op rather than a duplicate row.
 */
export class StreamEventRepository {
  private static async coll(): Promise<Collection<Document>> {
    return (await MongoService.getDb()).collection(STREAM_EVENTS_COLLECTION);
  }

  /**
   * Upserts a single score message as it arrives over the stream. Events lacking a `Seq` are
   * skipped (uncountable/unorderable) and logged.
   */
  static async insert(fixtureId: number, event: ScoreSnapshot, eventId?: string): Promise<number> {
    if (event.Seq === undefined) {
      logger.warn({ fixtureId, event }, "stream event missing Seq — skipped");
      return 0;
    }

    const now = new Date();
    const doc: StreamEventDoc = {
      fixtureId,
      seq: event.Seq,
      eventId,
      actionId: event.Id,
      action: event.Action,
      statusId: event.StatusId,
      ts: event.Ts !== undefined ? new Date(event.Ts) : now,
      receivedAt: now,
      payload: event,
    };

    const coll = await this.coll();
    try {
      const res = await withRetry(
        () => coll.updateOne({ fixtureId, seq: event.Seq }, { $setOnInsert: doc }, { upsert: true }),
        { retryOn: isTransientMongo },
      );
      return res.upsertedCount;
    } catch (err) {
      throw new DatabaseError("live_stream_events insert failed", err);
    }
  }

  /** Highest stored `{seq, ts}` for a fixture, used to sanity-check the worker's cursor. */
  static async findLatest(fixtureId: number): Promise<{ seq: number; ts: Date } | undefined> {
    const coll = await this.coll();
    const doc = await coll.find({ fixtureId }).sort({ seq: -1 }).limit(1).next();
    if (!doc) return undefined;
    return { seq: doc["seq"] as number, ts: doc["ts"] as Date };
  }
}

/** Transient MongoDB failures worth retrying (network blip, stepdown, not-primary, shutdown). */
function isTransientMongo(err: unknown): boolean {
  const labels = (err as { errorLabels?: string[] })?.errorLabels;
  const code = (err as { code?: number })?.code;
  return (
    !!labels?.includes("TransientTransactionError") ||
    (code !== undefined && [6, 7, 89, 91, 189, 11600, 11602].includes(code))
  );
}
