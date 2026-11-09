// Recording is best-effort and disables itself after repeated failures to protect live polling.

import type { Document } from "mongodb";
import { MongoService } from "../grid/mongo/mongo.service.js";
import { SeriesStateResponseSchema, hasGraphQLErrors } from "../grid/series-state.js";
import { withRetry } from "../live/retry.js";
import { logger } from "../grid/logger.js";

export const CS2_RAW_POLLS_COLLECTION = "cs2_raw_polls";

const MAX_CONSECUTIVE_FAILURES = 5;

export interface Cs2RawPollResult {
  data: unknown;
  status?: number;
  headers?: Record<string, unknown>;
}

interface Cs2RawPollDoc extends Document {
  seriesId: string;
  sessionKey: string;
  mapSequenceNumber: number;
  mapEnded?: true;
  receivedAt: Date;
  updatedAt?: string;
  httpStatus?: number;
  rateLimitRemaining?: string;
  payload: unknown;
}

interface Cs2RawSession {
  key: string;
  mapSequenceNumber: number;
}

/** One session per map, so a restart mid-map keeps writing to the same session. */
function sessionKeyFor(seriesId: string, mapSequenceNumber: number): string {
  return `cs2_series_${seriesId}_map_${mapSequenceNumber}`;
}

export class Cs2RawRecorder {
  private session: Cs2RawSession | undefined;
  private consecutiveFailures = 0;
  private disabled = false;
  private warnedMissingSequence = false;

  constructor(private readonly seriesId: string) {}

  async handlePoll(result: Cs2RawPollResult): Promise<void> {
    if (this.disabled) return;

    const parsed = SeriesStateResponseSchema.safeParse(result.data);
    if (!parsed.success || hasGraphQLErrors(parsed.data)) return;
    const res = parsed.data;

    // Only an explicit empty game list ends a map; a missing one is a bad frame.
    const games = res.data?.seriesState?.games;
    if (games === undefined) return;

    if (games.length === 0) {
      if (this.session === undefined) return;
      // Preserve the transition frame carrying the final map state.
      await this.write(this.session, res, result, true);
      logger.info({ seriesId: this.seriesId, sessionKey: this.session.key }, "cs2: raw recording session closed");
      this.session = undefined;
      return;
    }

    const mapSequenceNumber = games[0]?.sequenceNumber;
    if (mapSequenceNumber === undefined) {
      if (!this.warnedMissingSequence) {
        this.warnedMissingSequence = true;
        logger.warn({ seriesId: this.seriesId }, "cs2: live game without sequenceNumber — not recorded");
      }
      return;
    }

    if (this.session?.mapSequenceNumber !== mapSequenceNumber) {
      this.session = { key: sessionKeyFor(this.seriesId, mapSequenceNumber), mapSequenceNumber };
      logger.info({ seriesId: this.seriesId, sessionKey: this.session.key }, "cs2: raw recording session started");
    }
    await this.write(this.session, res, result, false);
  }

  private async write(session: Cs2RawSession, payload: unknown, result: Cs2RawPollResult, mapEnded: boolean): Promise<void> {
    const doc: Cs2RawPollDoc = {
      seriesId: this.seriesId,
      sessionKey: session.key,
      mapSequenceNumber: session.mapSequenceNumber,
      ...(mapEnded && { mapEnded: true as const }),
      receivedAt: new Date(),
      payload,
      ...(result.status !== undefined && { httpStatus: result.status }),
      ...(result.headers?.["x-ratelimit-remaining"] !== undefined && {
        rateLimitRemaining: result.headers["x-ratelimit-remaining"] as string,
      }),
    };

    try {
      const db = await MongoService.getDb();
      await withRetry(() => db.collection<Cs2RawPollDoc>(CS2_RAW_POLLS_COLLECTION).insertOne(doc));
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      logger.warn({ err, seriesId: this.seriesId, consecutiveFailures: this.consecutiveFailures }, "cs2: raw poll write failed");
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.disabled = true;
        logger.warn({ seriesId: this.seriesId }, "cs2: raw recording disabled after repeated write failures");
      }
    }
  }
}
