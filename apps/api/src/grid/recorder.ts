// Poll loop + state machine driving Grid.gg series-state recording.
//
//   WAITING_FOR_START --(0-0 detected)--> RECORDING --(games == [])--> WAITING_FOR_START
//
// A continuous watcher: after one match's recording ends, the recorder keeps polling and will
// start a brand-new collection on the next 0-0 it observes, without needing a restart.

import { gridConfig } from "./config/env.js";
import { GridClient } from "./grid-client.js";
import { RecordingSession } from "./recording-session.js";
import { SeriesStateResponseSchema, hasGraphQLErrors, hasLiveGame, isFreshStart } from "./series-state.js";
import { logger } from "./logger.js";
import { RateLimitExhaustedError, UpstreamApiError } from "./errors.js";
import { sleep } from "../shared/sleep.js";

type RecorderState = "WAITING_FOR_START" | "RECORDING";

/** Backoff schedule (ms) applied on consecutive poll failures, indexed by errorStreak - 1. */
const ERROR_BACKOFF_MS = [1_000, 5_000, 10_000, 30_000];

/** Cap on logged response body size to keep log lines readable. */
const MAX_LOGGED_BODY_BYTES = 20_000;

export class GridRecorder {
  private readonly client = new GridClient();
  private state: RecorderState = "WAITING_FOR_START";
  private session: RecordingSession | undefined;
  private errorStreak = 0;
  private running = false;
  private stopController: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopController = new AbortController();
    logger.info({ seriesId: gridConfig.grid.seriesId, intervalMs: gridConfig.grid.pollIntervalMs }, "grid: recorder starting");
    this.loopPromise = this.runLoop(this.stopController.signal);
  }

  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.stopController?.abort();
    await this.loopPromise;
    logger.info("grid: recorder stopped");
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (this.running) {
      try {
        const result = await this.client.fetchSeriesState(signal);
        this.logResponseBody(result.data);

        const parsed = SeriesStateResponseSchema.safeParse(result.data);
        if (!parsed.success) {
          logger.warn({ issues: parsed.error.issues }, "grid: response failed schema validation — skipped");
          await sleep(gridConfig.grid.pollIntervalMs, signal);
          continue;
        }

        this.errorStreak = 0;

        if (hasGraphQLErrors(parsed.data)) {
          logger.warn({ errors: parsed.data.errors }, "grid: response carried GraphQL-level errors — skipped");
          await sleep(gridConfig.grid.pollIntervalMs, signal);
          continue;
        }

        await this.handleResponse(parsed.data, result);
      } catch (err) {
        this.handlePollError(err);
        this.errorStreak += 1;
        const backoff = ERROR_BACKOFF_MS[Math.min(this.errorStreak - 1, ERROR_BACKOFF_MS.length - 1)] as number;
        await sleep(backoff, signal);
        continue;
      }

      await sleep(gridConfig.grid.pollIntervalMs, signal);
    }
  }

  private async handleResponse(
    parsed: ReturnType<typeof SeriesStateResponseSchema.parse>,
    result: { status: number; headers: Record<string, unknown> },
  ): Promise<void> {
    switch (this.state) {
      case "WAITING_FOR_START": {
        if (!isFreshStart(parsed)) return;
        this.session = new RecordingSession(gridConfig.grid.seriesId);
        this.state = "RECORDING";
        logger.info(
          { collectionName: this.session.collectionName, seriesId: gridConfig.grid.seriesId },
          "grid: 0-0 detected, recording started",
        );
        // Fall through: if this same frame already has a live game, record it immediately.
        if (hasLiveGame(parsed)) {
          await this.session.write({
            payload: parsed,
            httpStatus: result.status,
            updatedAt: parsed.data?.seriesState?.updatedAt as string | undefined,
            rateLimitRemaining: result.headers["x-ratelimit-remaining"] as string | undefined,
          });
        }
        return;
      }
      case "RECORDING": {
        const session = this.session;
        if (!session) {
          // Defensive: state says RECORDING but no session — fall back to waiting.
          this.state = "WAITING_FOR_START";
          return;
        }
        if (!hasLiveGame(parsed)) {
          logger.info(
            { collectionName: session.collectionName, docsWritten: session.writtenCount },
            "grid: games empty, recording stopped",
          );
          this.session = undefined;
          this.state = "WAITING_FOR_START";
          return;
        }
        await session.write({
          payload: parsed,
          httpStatus: result.status,
          updatedAt: parsed.data?.seriesState?.updatedAt as string | undefined,
          rateLimitRemaining: result.headers["x-ratelimit-remaining"] as string | undefined,
        });
        return;
      }
      default: {
        const exhaustive: never = this.state;
        throw new Error(`Unhandled recorder state: ${String(exhaustive)}`);
      }
    }
  }

  private handlePollError(err: unknown): void {
    if (err instanceof RateLimitExhaustedError) {
      logger.error({ err, seriesId: gridConfig.grid.seriesId }, "grid: rate limit retries exhausted");
      return;
    }
    if (err instanceof UpstreamApiError) {
      logger.error(
        { err, seriesId: gridConfig.grid.seriesId, upstreamStatus: err.upstreamStatus },
        "grid: upstream request failed",
      );
      return;
    }
    logger.error({ err, seriesId: gridConfig.grid.seriesId }, "grid: unexpected error during poll");
  }

  private logResponseBody(data: unknown): void {
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_LOGGED_BODY_BYTES) {
      logger.info(
        { body: serialized.slice(0, MAX_LOGGED_BODY_BYTES), truncated: true, fullLength: serialized.length },
        "grid: response received",
      );
    } else {
      logger.info({ body: data }, "grid: response received");
    }
  }
}
