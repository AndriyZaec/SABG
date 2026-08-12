// Best-effort raw-poll recorder for the live CS2 process (cs2/run.ts). Mirrors
// grid/recorder.ts's WAITING_FOR_START/RECORDING state machine (0-0 starts a session, the
// transition frame where games first empties is written before the session closes — that frame
// carries the map's final score) but, unlike grid/recorder.ts, has no poll loop of its own:
// Cs2LivePoller already owns polling, this only reacts to each poll's raw response. Writes go to
// one shared collection (not one collection per map, unlike grid/recording-session.ts) with a
// `sessionKey` field distinguishing maps, since this runs continuously across a whole live series
// rather than as a single-purpose recording run.
//
// Deliberately best-effort: a write failure only logs a warning and never reaches the caller —
// raw recording must never take down the live poller. After too many consecutive failures (e.g.
// Mongo unreachable for the whole process lifetime) recording disables itself so the CS2 process
// doesn't retry-storm or spam warnings for the rest of the match.

import type { Document } from "mongodb";
import { MongoService } from "../grid/mongo/mongo.service.js";
import { mintCollectionName } from "../grid/recording-session.js";
import { SeriesStateResponseSchema, hasGraphQLErrors, hasLiveGame, isFreshStart } from "../grid/series-state.js";
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
  receivedAt: Date;
  updatedAt?: string;
  httpStatus?: number;
  rateLimitRemaining?: string;
  payload: unknown;
}

type RecorderState = "WAITING_FOR_START" | "RECORDING";

export class Cs2RawRecorder {
  private state: RecorderState = "WAITING_FOR_START";
  private sessionKey: string | undefined;
  private consecutiveFailures = 0;
  private disabled = false;

  constructor(private readonly seriesId: string) {}

  async handlePoll(result: Cs2RawPollResult): Promise<void> {
    if (this.disabled) return;

    const parsed = SeriesStateResponseSchema.safeParse(result.data);
    if (!parsed.success || hasGraphQLErrors(parsed.data)) return;
    const res = parsed.data;

    switch (this.state) {
      case "WAITING_FOR_START": {
        if (!isFreshStart(res)) return;
        this.sessionKey = mintCollectionName(this.seriesId);
        this.state = "RECORDING";
        logger.info({ seriesId: this.seriesId, sessionKey: this.sessionKey }, "cs2: raw recording session started");
        // Fall through: if this same frame already has a live game, record it immediately.
        if (hasLiveGame(res)) await this.write(res, result);
        return;
      }
      case "RECORDING": {
        if (!hasLiveGame(res)) {
          // Write the transition frame itself before closing out — the only snapshot carrying
          // the map's final score/finished state.
          await this.write(res, result);
          logger.info({ seriesId: this.seriesId, sessionKey: this.sessionKey }, "cs2: raw recording session closed");
          this.sessionKey = undefined;
          this.state = "WAITING_FOR_START";
          return;
        }
        await this.write(res, result);
        return;
      }
      default: {
        const exhaustive: never = this.state;
        throw new Error(`Unhandled raw-recorder state: ${String(exhaustive)}`);
      }
    }
  }

  private async write(payload: unknown, result: Cs2RawPollResult): Promise<void> {
    if (this.sessionKey === undefined) return;
    const doc: Cs2RawPollDoc = {
      seriesId: this.seriesId,
      sessionKey: this.sessionKey,
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
