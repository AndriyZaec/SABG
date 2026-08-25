import { randomUUID } from "node:crypto";
import type { Answer, MatchSignal, MatchState, PredictionRound, SettledBy, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { initialPlannerState, planRoundActions, type PlannerState } from "./planner.js";
import { createStubQuestionProvider, type QuestionProvider } from "./question-provider.js";

export type RoundLifecycleEvent =
  | {
      type: "open";
      round: PredictionRound;
      // This is a projection only; the match clock remains authoritative.
      lockAt: string;
    }
  | { type: "lock"; roundId: Uuid; windowStartMinute: number };

export interface RoundEngineOptions {
  questionProvider?: QuestionProvider;
  // Must match the driver's pace to keep the projected lock time truthful.
  secondsPerMatchMinute?: number;
  getMatchState?: () => MatchState | undefined;
  teamNames?: { home: string; away: string };
  isArenaFinished?: () => boolean;
  onTransition?: (event: RoundLifecycleEvent) => void;
}

const DEFAULT_SECONDS_PER_MATCH_MINUTE = 60;

export class RoundEngine {
  private plannerState: PlannerState = initialPlannerState();
  private readonly rounds = new Map<number, PredictionRound>();
  private readonly questionProvider: QuestionProvider;
  private readonly secondsPerMatchMinute: number;

  constructor(
    private readonly matchId: Uuid,
    private readonly arenaId: Uuid,
    private readonly options: RoundEngineOptions = {},
  ) {
    this.questionProvider = options.questionProvider ?? createStubQuestionProvider();
    this.secondsPerMatchMinute = options.secondsPerMatchMinute ?? DEFAULT_SECONDS_PER_MATCH_MINUTE;
  }

  get roundsByWindow(): ReadonlyMap<number, PredictionRound> {
    return this.rounds;
  }

  markSettled(windowStartMinute: number, correctAnswer: Answer, settledBy: SettledBy): PredictionRound | undefined {
    const round = this.rounds.get(windowStartMinute);
    if (round === undefined) return undefined;

    const settled: PredictionRound = {
      ...round,
      status: "settled",
      correctAnswer,
      settledAt: new Date().toISOString(),
      settledBy,
    };
    this.rounds.set(windowStartMinute, settled);
    return settled;
  }

  apply(signal: MatchSignal): void {
    if (signal.kind !== "clock") return;

    const { state, actions } = planRoundActions(this.plannerState, {
      period: signal.period,
      minute: signal.matchMinute,
    });
    this.plannerState = state;

    // Re-check after each action because a same-tick lock can synchronously finish the arena.
    for (const action of actions) {
      if (action.kind === "open") {
        if (this.options.isArenaFinished?.() === true) continue;
        this.handleOpen(action.windowStart, signal.matchMinute);
      } else {
        this.handleLock(action.windowStart);
      }
    }
  }

  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }

  private handleOpen(windowStart: number, currentMinute: number): void {
    const windowEndMinute = windowStart + 5;
    const generated = this.questionProvider.generate({
      matchId: this.matchId,
      arenaId: this.arenaId,
      windowStartMinute: windowStart,
      windowEndMinute,
      matchState: this.options.getMatchState?.(),
      teamNames: this.options.teamNames,
    });

    const round: PredictionRound = {
      id: randomUUID(),
      arenaId: this.arenaId,
      matchId: this.matchId,
      discipline: "soccer",
      windowStartMinute: windowStart,
      windowEndMinute,
      question: generated.question,
      targetEventType: generated.targetEventType,
      targetTeam: generated.targetTeam,
      settlementCondition: generated.settlementCondition,
      status: "open",
      openedAt: new Date().toISOString(),
    };
    this.rounds.set(windowStart, round);

    const minutesUntilWindow = Math.max(windowStart - currentMinute, 0);
    const lockAt = new Date(
      Date.now() + minutesUntilWindow * this.secondsPerMatchMinute * 1000,
    ).toISOString();

    this.options.onTransition?.({ type: "open", round, lockAt });
  }

  private handleLock(windowStart: number): void {
    const round = this.rounds.get(windowStart);
    if (round === undefined) return;

    const locked: PredictionRound = { ...round, status: "locked", lockedAt: new Date().toISOString() };
    this.rounds.set(windowStart, locked);

    this.options.onTransition?.({ type: "lock", roundId: locked.id, windowStartMinute: windowStart });
  }
}
