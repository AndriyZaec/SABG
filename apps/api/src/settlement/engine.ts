// Settlement Engine's side-effecting edge: watches locked rounds against the MatchSignalBus,
// calling the pure resolveSettlement (spec §6: early on a confirmed matching event, window-end
// otherwise) and marking each active player's Prediction/ArenaPlayer outcome through injected
// seams (real, persisted implementations are supplied later).

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

  /** Starts tracking a round that was just locked. Idempotent — a repeat call for the same window is a no-op. */
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
    // rawEvent.team can be "any" — normalize.ts's participantToSide falls back to it for a raw
    // message it can't attribute to a specific side. Whether that's real settlement evidence
    // depends on *which round's* condition it's being checked against, not on this event alone:
    // resolveSettlement already correctly credits it for a targetTeam:"any" condition (the
    // question doesn't care which team) while still rejecting it for a specific-team one (we
    // genuinely can't confirm that side did it) — see SettleableEvent's doc comment. So this
    // event is always forwarded; the per-condition decision happens downstream.
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
      // Spec §6: window-end fires once match minute is *strictly greater than* windowEndMinute,
      // not >=. A message confirming an event AT windowEndMinute can arrive after an earlier,
      // still-provisional message has already ticked the clock to that same minute — confirmation
      // is inherently a separate, sometimes-later message (found via the full-pipeline test:
      // fixture 18179764 Seq 296 ticks minute 30 while provisional; Seq 297 confirms the same
      // shot one message later). Settling "no" the instant minute==windowEndMinute would still
      // beat that confirmation to the punch. hasReachedMinute is >=-based (correct for the round
      // engine's inclusive "lock exactly at T"); express the strict ">" here via `windowEndMinute + 1`.
      if (hasReachedMinute(tick, entry.round.windowEndMinute + 1, req)) {
        toSettle.push({ windowStart, answer: resolveSettlement(entry.round.settlementCondition, entry.events) });
      }
    }
    for (const { windowStart, answer } of toSettle) this.settle(windowStart, answer, "window_end");
  }

  private settle(windowStart: number, correctAnswer: Answer, settledBy: SettledBy): void {
    const entry = this.tracked.get(windowStart);
    if (entry === undefined) return; // already settled — idempotency guard
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
