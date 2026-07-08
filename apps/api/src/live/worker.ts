// Ported from world-cup's services/match-event-stream-worker.ts, with two changes from the
// draft:
//  - no Redis cursor persistence: `lastEventId`/`lastSeq` live only in process memory (the
//    no-Redis decision for this port — a restart just starts the stream fresh rather than
//    resuming exactly where it left off);
//  - `handleMessage` both persists the raw message (StreamEventRepository, Mongo) and feeds it
//    through the shared B1 match-signal producer, publishing every `MatchSignal` (settlement
//    events + clock/possession) onto the S3 bus.

import type { MatchSignal } from "@arena/contracts";
import { streamEvents, type StreamMessage } from "./sse-client.js";
import { StreamEventRepository } from "./mongo/stream-event.repository.js";
import { RateLimitState } from "./rate-limit.js";
import { logger } from "./logger.js";
import { isFinishedStatus, type ScoreSnapshot } from "../ingestion/score-snapshot.js";
import { createMatchSignalProducer, type MatchSignalProducer } from "../ingestion/match-signal.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";

/** How long to keep the stream open after `finished`, to catch trailing amend messages. */
const SETTLE_MS = 15_000;
/** Reconnect backoff schedule (ms), capped at the last value. */
const RECONNECT_BACKOFF_MS = [1_000, 5_000, 10_000, 30_000];

/**
 * Background worker: consumes the real-time `/scores/stream` SSE feed for one fixture over a
 * single long-lived connection (no polling interval — events are handled the instant each
 * frame arrives), persisting every raw message to Mongo and publishing `MatchSignal`s onto a
 * `MatchSignalBus` (S3).
 */
export class LiveIngestionWorker {
  private running = false;
  private lastSeq = -1;
  private lastEventId: string | undefined;
  private errorStreak = 0;
  private abort: AbortController | undefined;
  private settleTimer: NodeJS.Timeout | undefined;
  private finished = false;
  private readonly producer: MatchSignalProducer;

  constructor(
    private readonly matchId: string,
    private readonly bus: MatchSignalBus,
  ) {
    this.producer = createMatchSignalProducer(matchId);
  }

  async start(fixtureId: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.finished = false;

    logger.info({ fixtureId }, "live ingestion worker starting");

    void this.runLoop(fixtureId).catch((err) => {
      logger.error({ err, fixtureId }, "live ingestion worker loop crashed");
    });
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.abort = undefined;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  shutdown(): void {
    this.stop();
  }

  status() {
    return { running: this.running, lastSeq: this.lastSeq, lastEventId: this.lastEventId, finished: this.finished };
  }

  private async runLoop(fixtureId: number): Promise<void> {
    const log = logger.child({ fixtureId });

    while (this.running) {
      const now = Date.now();
      if (now < RateLimitState.retryAfterUntil) {
        await sleep(RateLimitState.retryAfterUntil - now);
        continue;
      }

      this.abort = new AbortController();
      try {
        const messages = streamEvents(fixtureId, this.lastEventId, this.abort.signal);
        for await (const msg of messages) {
          if (!this.running) break;
          this.errorStreak = 0;
          await this.handleMessage(fixtureId, msg);
          if (!this.running) break;
        }

        // The stream ended on its own (server closed it) rather than being stopped by us.
        if (!this.running || this.finished) break;
        log.warn({ fixtureId }, "stream ended unexpectedly — reconnecting");
      } catch (err) {
        if (!this.running || this.finished) break;
        if (isAuthError(err)) {
          log.warn({ err, fixtureId }, "stream auth rejected (401/403) — will retry with fresh tokens");
        } else {
          log.error({ err }, "stream error");
        }
      }

      if (!this.running || this.finished) break;
      const backoff = RECONNECT_BACKOFF_MS[Math.min(this.errorStreak, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
      this.errorStreak += 1;
      await sleep(backoff);
    }
  }

  private async handleMessage(fixtureId: number, msg: StreamMessage): Promise<void> {
    if (msg.kind === "heartbeat") {
      logger.debug({ fixtureId, id: msg.id }, "stream heartbeat");
      return;
    }

    const event = msg.event;
    if (event.Seq !== undefined && event.Seq <= this.lastSeq) {
      return; // already-seen frame (e.g. replayed after a Last-Event-ID reconnect)
    }

    await StreamEventRepository.insert(fixtureId, event, msg.id);

    for (const signal of this.producer.process(event)) {
      this.publish(signal);
    }

    if (event.Seq !== undefined) this.lastSeq = event.Seq;
    if (msg.id !== undefined) this.lastEventId = msg.id;

    if (isMatchFinished(event)) {
      this.armSettle(fixtureId);
    }
  }

  private publish(signal: MatchSignal): void {
    this.bus.publish(signal);
  }

  private armSettle(fixtureId: number): void {
    this.finished = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      logger.info({ fixtureId }, "match finished — settle window elapsed, stopping stream worker");
      this.stop();
    }, SETTLE_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMatchFinished(event: ScoreSnapshot): boolean {
  return isFinishedStatus(event.StatusId) || event.Action === "game_finalised";
}

/** True when `err` is an axios error carrying an HTTP 401/403 response (guest JWT / API token rejected). */
function isAuthError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 401 || status === 403;
}
