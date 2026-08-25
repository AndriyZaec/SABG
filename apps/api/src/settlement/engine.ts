import type {
  Answer,
  LiveEvent,
  MatchSignal,
  PredictionRound,
  SettleableEvent,
  SettledBy,
  SoccerSettlementCondition,
  Uuid,
} from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { hasReachedMinute, requiredPeriod, type ClockTick } from "../round-engine/planner.js";
import { resolveSettlement } from "./resolve.js";
import { createInMemoryPredictionStore, type PredictionStore } from "./prediction-store.js";
import { createInMemoryArenaPlayerStore, type ArenaPlayerStore } from "./arena-player-store.js";
import { applyRoundOutcome, type PlayerResultEvent } from "./apply-outcome.js";

export type { PlayerResultEvent };

type SoccerPredictionRound = PredictionRound & {
  windowStartMinute: number;
  windowEndMinute: number;
  settlementCondition: SoccerSettlementCondition;
};

function assertSoccerRound(round: PredictionRound): SoccerPredictionRound {
  if (round.discipline !== "soccer" || round.windowStartMinute === undefined || round.windowEndMinute === undefined) {
    throw new Error(`SettlementEngine only tracks soccer rounds, got round ${round.id} (discipline=${round.discipline})`);
  }
  return round as SoccerPredictionRound;
}

export interface SettlementEvent {
  type: "settle";
  roundId: Uuid;
  windowStartMinute: number;
  correctAnswer: Answer;
  settledBy: SettledBy;
}

export interface SettlementEngineOptions {
  predictionStore?: PredictionStore;
  arenaPlayerStore?: ArenaPlayerStore;
  onSettled?: (event: SettlementEvent) => void;
  onPlayerResult?: (event: PlayerResultEvent) => void;
}

interface TrackedRound {
  round: SoccerPredictionRound;
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

  // Repeated lock delivery must not erase already collected settlement evidence.
  onRoundLocked(round: PredictionRound): void {
    const soccerRound = assertSoccerRound(round);
    if (this.tracked.has(soccerRound.windowStartMinute)) return;
    this.tracked.set(soccerRound.windowStartMinute, { round: soccerRound, events: [] });
  }

  apply(signal: MatchSignal): void {
    if (signal.kind === "event") this.handleEvent(signal.event);
    else if (signal.kind === "clock") this.handleClock({ period: signal.period, minute: signal.matchMinute });
  }

  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }

  private handleEvent(rawEvent: LiveEvent): void {
    // Ambiguous team attribution is valid only for conditions that accept either team.
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
      // Settle strictly after the end minute so same-minute confirmations can still arrive.
      if (hasReachedMinute(tick, entry.round.windowEndMinute + 1, req)) {
        toSettle.push({ windowStart, answer: resolveSettlement(entry.round.settlementCondition, entry.events) });
      }
    }
    for (const { windowStart, answer } of toSettle) this.settle(windowStart, answer, "window_end");
  }

  private settle(windowStart: number, correctAnswer: Answer, settledBy: SettledBy): void {
    const entry = this.tracked.get(windowStart);
    if (entry === undefined) return; // A settled window must not emit duplicate outcomes.
    this.tracked.delete(windowStart);

    const { round } = entry;
    applyRoundOutcome(
      round.id,
      this.arenaId,
      correctAnswer,
      { predictionStore: this.predictionStore, arenaPlayerStore: this.arenaPlayerStore },
      this.options.onPlayerResult,
    );

    this.options.onSettled?.({ type: "settle", roundId: round.id, windowStartMinute: windowStart, correctAnswer, settledBy });
  }
}
