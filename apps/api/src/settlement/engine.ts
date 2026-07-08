// B4 — Settlement Engine's side-effecting edge: watches locked rounds (from B3) against the S3
// MatchSignalBus, calling the pure resolveSettlement (spec §6: early on a confirmed matching
// event, window-end otherwise) and marking each active player's Prediction/ArenaPlayer outcome
// through injected seams (B7 supplies real, persisted implementations later).

import type {
  Answer,
  ArenaPlayerStatus,
  LiveEvent,
  MatchSignal,
  PredictionResult,
  PredictionRound,
  SettleableEvent,
  SettledBy,
  Uuid,
} from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { hasReachedMinute, requiredPeriod, type ClockTick } from "../round-engine/planner.js";
import { resolveSettlement } from "./resolve.js";
import { createInMemoryPredictionStore, type PredictionStore } from "./prediction-store.js";
import { createInMemoryArenaPlayerStore, type ArenaPlayerStore } from "./arena-player-store.js";

export interface SettlementEvent {
  type: "settle";
  roundId: Uuid;
  windowStartMinute: number;
  correctAnswer: Answer;
  settledBy: SettledBy;
}

export interface PlayerResultEvent {
  roundId: Uuid;
  userId: Uuid;
  /** The player's submitted answer, or undefined if they never answered (spec §6 "missed"). */
  answer: Answer | undefined;
  result: PredictionResult;
  status: ArenaPlayerStatus;
}

export interface SettlementEngineOptions {
  predictionStore?: PredictionStore;
  arenaPlayerStore?: ArenaPlayerStore;
  onSettled?: (event: SettlementEvent) => void;
  onPlayerResult?: (event: PlayerResultEvent) => void;
}

interface TrackedRound {
  round: PredictionRound;
  events: SettleableEvent[];
}

export class SettlementEngine {
  private readonly tracked = new Map<number, TrackedRound>();
  private readonly predictionStore: PredictionStore;
  private readonly arenaPlayerStore: ArenaPlayerStore;

  constructor(
    private readonly arenaId: Uuid,
    private readonly options: SettlementEngineOptions = {},
  ) {
    this.predictionStore = options.predictionStore ?? createInMemoryPredictionStore();
    this.arenaPlayerStore = options.arenaPlayerStore ?? createInMemoryArenaPlayerStore(arenaId, []);
  }

  /** Starts tracking a round B3 just locked. Idempotent — a repeat call for the same window is a no-op. */
  onRoundLocked(round: PredictionRound): void {
    if (this.tracked.has(round.windowStartMinute)) return;
    this.tracked.set(round.windowStartMinute, { round, events: [] });
  }

  apply(signal: MatchSignal): void {
    if (signal.kind === "event") this.handleEvent(signal.event);
    else if (signal.kind === "clock") this.handleClock({ period: signal.period, minute: signal.matchMinute });
    // possession signals carry no settlement information (spec §4.1: context-only) — ignored.
  }

  /** Subscribes to `bus`, applying every published signal. Returns an unsubscribe function. */
  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }

  private handleEvent(rawEvent: LiveEvent): void {
    // LiveEvent.team is typed TeamSide (includes "any"), but SettleableEvent.team excludes it.
    // normalize.ts's participantToSide does fall back to "any" for an unattributable raw
    // message, so this is a real case — treated as *not* settlement evidence at all, even for a
    // targetTeam:"any" condition, since we don't actually know a team performed it.
    if (rawEvent.team === "any") return;

    const event: SettleableEvent = {
      eventType: rawEvent.eventType,
      team: rawEvent.team,
      matchMinute: rawEvent.matchMinute,
      confirmed: rawEvent.confirmed,
    };

    const toSettle: number[] = [];
    for (const [windowStart, entry] of this.tracked) {
      entry.events.push(event);
      if (resolveSettlement(entry.round.settlementCondition, entry.events) === "yes") {
        toSettle.push(windowStart);
      }
    }
    for (const windowStart of toSettle) this.settle(windowStart, "yes", "early");
  }

  private handleClock(tick: ClockTick): void {
    const toSettle: { windowStart: number; answer: Answer }[] = [];
    for (const [windowStart, entry] of this.tracked) {
      const req = requiredPeriod(entry.round.windowStartMinute);
      if (hasReachedMinute(tick, entry.round.windowEndMinute, req)) {
        toSettle.push({ windowStart, answer: resolveSettlement(entry.round.settlementCondition, entry.events) });
      }
    }
    for (const { windowStart, answer } of toSettle) this.settle(windowStart, answer, "window_end");
  }

  private settle(windowStart: number, correctAnswer: Answer, settledBy: SettledBy): void {
    const entry = this.tracked.get(windowStart);
    if (entry === undefined) return; // already settled — idempotency guard (DoD)
    this.tracked.delete(windowStart);

    const { round } = entry;
    const answers = this.predictionStore.getAnswers(round.id);

    for (const userId of this.arenaPlayerStore.getActivePlayerIds(this.arenaId)) {
      const answer = answers.get(userId);
      const result: PredictionResult = answer === undefined ? "missed" : answer === correctAnswer ? "correct" : "incorrect";
      const status: ArenaPlayerStatus = result === "correct" ? "active" : "eliminated";

      this.predictionStore.recordResult(round.id, userId, result);
      this.arenaPlayerStore.setStatus(userId, status);
      this.options.onPlayerResult?.({ roundId: round.id, userId, answer, result, status });
    }

    this.options.onSettled?.({ type: "settle", roundId: round.id, windowStartMinute: windowStart, correctAnswer, settledBy });
  }
}
