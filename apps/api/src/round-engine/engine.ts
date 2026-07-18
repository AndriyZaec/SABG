// Round Engine's side-effecting edge: turns planner actions into real `PredictionRound`s
// (in-memory, spec §13), driven by the MatchSignalBus like MatchStateEngine. Persistence to
// Postgres and the WS push are deferred to the gateway — this module only emits
// `RoundLifecycleEvent`s.

import { randomUUID } from "node:crypto";
import type { Answer, MatchSignal, MatchState, PredictionRound, SettledBy, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { initialPlannerState, planRoundActions, type PlannerState } from "./planner.js";
import { createStubQuestionProvider, type QuestionProvider } from "./question-provider.js";

export type RoundLifecycleEvent =
  | {
      type: "open";
      round: PredictionRound;
      /**
       * When the round will lock, for the client countdown. Lock fires when the match clock
       * crosses windowStartMinute; each remaining match-minute takes `secondsPerMatchMinute` real
       * seconds, so this matches the real lock time as long as the driver advances the clock at
       * that same rate (a live feed's stoppage can push the real lock slightly later). The clock
       * is still the authority — round.lock/settle are what actually resolve the round.
       */
      lockAt: string;
    }
  | { type: "lock"; roundId: Uuid; windowStartMinute: number };

export interface RoundEngineOptions {
  questionProvider?: QuestionProvider;
  /**
   * Real seconds per match-minute, used only to project `lockAt` for the client countdown.
   * Defaults to 60 (real time — correct for a live feed). A driver that compresses the match
   * (the demo replay) sets this to its own pace so the countdown stays truthful.
   */
  secondsPerMatchMinute?: number;
  /** Supplies context to the QuestionProvider — wire to a MatchStateEngine's snapshot. */
  getMatchState?: () => MatchState | undefined;
  /** Real home/away team names, forwarded to the QuestionProvider on every open (see
   *  question-provider.ts's QuestionContext). Falls back to "Home"/"Away" when omitted. */
  teamNames?: { home: string; away: string };
  /** True once the arena has finished (winners declared). When set, no further rounds are
   *  created — the clock keeps ticking but the game is over (spec §7). */
  isArenaFinished?: () => boolean;
  onTransition?: (event: RoundLifecycleEvent) => void;
}

/** Real time a match-minute takes on a live feed — the default `lockAt` projection rate. */
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

    // Once winners are declared, stop opening new rounds — but still let a round that was
    // already open at that moment lock and settle normally rather than dangling forever open.
    // Re-checked per action (not cached once): a lock and the next window's open often land in
    // the same tick, and settling that lock can synchronously declare the finish (early-settle
    // -> leaderboard finish, via onTransition below) before this loop reaches the open action.
    for (const action of actions) {
      if (action.kind === "open") {
        if (this.options.isArenaFinished?.() === true) continue; // game over — no further rounds
        this.handleOpen(action.windowStart, signal.matchMinute);
      } else {
        this.handleLock(action.windowStart);
      }
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
      teamNames: this.options.teamNames,
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

    // Projected lock time for the client countdown (see RoundLifecycleEvent doc comment above).
    const minutesUntilWindow = Math.max(windowStart - currentMinute, 0);
    const lockAt = new Date(
      Date.now() + minutesUntilWindow * this.secondsPerMatchMinute * 1000,
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
