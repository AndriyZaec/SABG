// Round Engine's side-effecting edge: turns planner actions into real `PredictionRound`s
// (in-memory, spec §13), driven by the MatchSignalBus like MatchStateEngine. Persistence to
// Postgres and the WS push are deferred to the gateway — this module only emits
// `RoundLifecycleEvent`s.

import { randomUUID } from "node:crypto";
import { MIN_LEAD_TIME_SECONDS } from "@arena/contracts";
import type { Answer, MatchSignal, MatchState, PredictionRound, SettledBy, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { initialPlannerState, planRoundActions, type PlannerState } from "./planner.js";
import { createStubQuestionProvider, type QuestionProvider } from "./question-provider.js";

export type RoundLifecycleEvent =
  | {
      type: "open";
      round: PredictionRound;
      /**
       * Estimate for client countdown only — NOT authoritative. The real lock fires off the
       * match clock crossing windowStartMinute (spec §5.1), never off this wall-clock guess.
       *
       * The guess assumes 1 match-minute of remaining lead time takes ~60 real seconds (true for
       * a live feed). `leadTimeSeconds` (RoundEngineOptions) is only a floor on this estimate, not
       * an override of that assumption — for every round after the first, `handleOpen` computes
       * ~5 real minutes remaining (windows are 5 match-minutes apart, and each round opens the
       * instant its predecessor locks), which dwarfs any small `leadTimeSeconds` value. A caller
       * that replays match-clock ticks faster or slower than real time (e.g. gateway/run.ts's
       * GATEWAY_REPLAY_DELAY_MS-paced demo) will therefore see this estimate badly mismatch the
       * real lock time for rounds 2+; only `leadTimeSeconds` alone can't fix that. Don't build a
       * precise countdown off this field under non-real-time playback — only round.lock/settle
       * are ever authoritative.
       */
      lockAt: string;
    }
  | { type: "lock"; roundId: Uuid; windowStartMinute: number };

export interface RoundEngineOptions {
  questionProvider?: QuestionProvider;
  /** Minimum lead time before lock (spec §5, default MIN_LEAD_TIME_SECONDS = 60s). */
  leadTimeSeconds?: number;
  /** Supplies context to the QuestionProvider (spec §4.2) — wire to a MatchStateEngine's snapshot. */
  getMatchState?: () => MatchState | undefined;
  onTransition?: (event: RoundLifecycleEvent) => void;
}

export class RoundEngine {
  private plannerState: PlannerState = initialPlannerState();
  private readonly rounds = new Map<number, PredictionRound>();
  private readonly questionProvider: QuestionProvider;
  private readonly leadTimeSeconds: number;

  constructor(
    private readonly matchId: Uuid,
    private readonly arenaId: Uuid,
    private readonly options: RoundEngineOptions = {},
  ) {
    this.questionProvider = options.questionProvider ?? createStubQuestionProvider();
    this.leadTimeSeconds = options.leadTimeSeconds ?? MIN_LEAD_TIME_SECONDS;
  }

  /** Rounds created so far, keyed by windowStartMinute (open, locked, or settled). */
  get roundsByWindow(): ReadonlyMap<number, PredictionRound> {
    return this.rounds;
  }

  /**
   * Called by wiring once the Settlement Engine resolves a locked round, so `PredictionRound`
   * stays the single source of truth for round state (no shadow copy inside the Settlement
   * Engine). Mirrors the `handleLock` mutation pattern below.
   */
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
    if (signal.kind !== "clock") return; // only reacts to the match clock (spec §5.1)

    const { state, actions } = planRoundActions(this.plannerState, {
      period: signal.period,
      minute: signal.matchMinute,
    });
    this.plannerState = state;

    for (const action of actions) {
      if (action.kind === "open") this.handleOpen(action.windowStart, signal.matchMinute);
      else this.handleLock(action.windowStart);
    }
  }

  /** Subscribes to `bus`, applying every published signal. Returns an unsubscribe function. */
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
    });

    const round: PredictionRound = {
      id: randomUUID(),
      arenaId: this.arenaId,
      matchId: this.matchId,
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

    // Display-only projection of when lock will happen, for a client countdown — never
    // authoritative (see RoundLifecycleEvent doc comment above).
    const minutesUntilWindow = Math.max(windowStart - currentMinute, 0);
    const lockAt = new Date(
      Date.now() + Math.max(minutesUntilWindow * 60, this.leadTimeSeconds) * 1000,
    ).toISOString();

    this.options.onTransition?.({ type: "open", round, lockAt });
  }

  private handleLock(windowStart: number): void {
    const round = this.rounds.get(windowStart);
    if (round === undefined) return; // shouldn't happen — the planner only locks what it opened

    const locked: PredictionRound = { ...round, status: "locked", lockedAt: new Date().toISOString() };
    this.rounds.set(windowStart, locked);

    this.options.onTransition?.({ type: "lock", roundId: locked.id, windowStartMinute: windowStart });
  }
}
