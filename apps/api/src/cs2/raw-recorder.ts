// Recording is best-effort and disables itself after repeated failures to protect live polling.

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
        if (hasLiveGame(res)) await this.write(res, result);
        return;
      }
      case "RECORDING": {
        if (!hasLiveGame(res)) {
          // Preserve the transition frame carrying the final map state.
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
