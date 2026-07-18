// Ported from world-cup's services/match-event-stream-worker.ts, with two changes from the
// draft:
//  - no Redis cursor persistence: `lastEventId`/`lastSeq` live only in process memory (the
//    no-Redis decision for this port — a restart just starts the stream fresh rather than
//    resuming exactly where it left off);
//  - `handleMessage` both persists the raw message (StreamEventRepository, Mongo) and feeds it
//    through the shared match-signal producer, publishing every `MatchSignal` (settlement
//    events + clock/possession) onto the shared bus.

import type { MatchSignal } from "@arena/contracts";
import { streamEvents, type StreamMessage } from "./sse-client.js";
import { StreamEventRepository } from "./mongo/stream-event.repository.js";
import { RateLimitState } from "./rate-limit.js";
import { logger } from "./logger.js";
import { isFinishedStatus, type ScoreSnapshot } from "../ingestion/score-snapshot.js";
import { createMatchSignalProducer, type MatchSignalProducer } from "../ingestion/match-signal.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { sleep } from "../shared/sleep.js";

/** How long to keep the stream open after `finished`, to catch trailing amend messages. */
const SETTLE_MS = 15_000;
/** Reconnect backoff schedule (ms), capped at the last value. */
const RECONNECT_BACKOFF_MS = [1_000, 5_000, 10_000, 30_000];

/**
 * Background worker: consumes the real-time `/scores/stream` SSE feed for one fixture over a
 * single long-lived connection (no polling interval — events are handled the instant each
 * frame arrives), persisting every raw message to Mongo and publishing `MatchSignal`s onto a
 * `MatchSignalBus`.
 */
export class LiveIngestionWorker {
  private running = false;
  private lastSeq = -1;
  private lastEventId: string | undefined;
  private errorStreak = 0;
  private abort: AbortController | undefined;
  private stopController = new AbortController();
  private settleTimer: NodeJS.Timeout | undefined;
  private finished = false;
  private runPromise: Promise<void> | undefined;
  private readyPromise: Promise<boolean> = Promise.resolve(false);
  private resolveReady: ((ready: boolean) => void) | undefined;
  private readonly activationPromise: Promise<void>;
  private resolveActivation: (() => void) | undefined;
  private activated = false;
  private readonly producer: MatchSignalProducer;

  constructor(
    private readonly matchId: string,
    private readonly bus: MatchSignalBus,
  ) {
    this.producer = createMatchSignalProducer(matchId);
    this.activationPromise = new Promise<void>((resolve) => {
      this.resolveActivation = resolve;
    });
  }

  async start(fixtureId: number): Promise<void> {
    if (this.running) return;
    if (this.stopController.signal.aborted) throw new Error("Cannot start a stopped live ingestion worker");
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.resolveReady = resolve;
    });
    const latest = await StreamEventRepository.findLatest(fixtureId);
    if (this.stopController.signal.aborted) {
      this.markReady(false);
      return;
    }
    this.running = true;
    this.finished = false;
    this.lastSeq = latest?.seq ?? -1;

    logger.info({ fixtureId }, "live ingestion worker starting");

    this.runPromise = this.runLoop(fixtureId)
      .catch((err) => {
        logger.error({ err, fixtureId }, "live ingestion worker loop crashed");
      })
      .finally(() => {
        this.running = false;
      });
  }

  async waitUntilStopped(): Promise<void> {
    await this.runPromise;
  }

  async waitUntilReady(timeoutMs: number): Promise<void> {
    const timeoutController = new AbortController();
    const stopTimeout = () => timeoutController.abort();
    this.stopController.signal.addEventListener("abort", stopTimeout, { once: true });
    const ready = await Promise.race([this.readyPromise, sleep(timeoutMs, timeoutController.signal).then(() => false)]);
    this.stopController.signal.removeEventListener("abort", stopTimeout);
    timeoutController.abort();
    if (!ready) throw new Error(`Live ingestion stream did not become ready within ${timeoutMs}ms`);
  }

  activate(): void {
    if (this.activated) return;
    this.activated = true;
    this.resolveActivation?.();
    this.resolveActivation = undefined;
  }

  stop(): void {
    this.running = false;
    this.markReady(false);
    this.resolveActivation?.();
    this.resolveActivation = undefined;
    this.stopController.abort();
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
        await sleep(RateLimitState.retryAfterUntil - now, this.stopController.signal);
        continue;
      }

      this.abort = new AbortController();
      try {
        const messages = streamEvents(fixtureId, this.lastEventId, this.abort.signal);
        for await (const msg of messages) {
          if (!this.running) break;
          this.markReady(true);
          if (!this.activated) await this.activationPromise;
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
      await sleep(backoff, this.stopController.signal);
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

    const inserted = await StreamEventRepository.insert(fixtureId, event, msg.id);
    if (inserted === 0 && event.Seq !== undefined) {
      this.lastSeq = event.Seq;
      if (msg.id !== undefined) this.lastEventId = msg.id;
      return;
    }

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

  private markReady(ready: boolean): void {
    this.resolveReady?.(ready);
    this.resolveReady = undefined;
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

function isMatchFinished(event: ScoreSnapshot): boolean {
  return isFinishedStatus(event.StatusId) || event.Action === "game_finalised";
}

/** True when `err` is an axios error carrying an HTTP 401/403 response (guest JWT / API token rejected). */
function isAuthError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 401 || status === 403;
}
