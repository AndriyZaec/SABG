// Round Engine's side-effecting edge for CS2 (cs2-migration-spec/spec_v2.md §7, cascading
// generation) — mirrors round-engine/engine.ts's shape (in-memory state, MatchSignalBus-driven,
// emits lifecycle events, no persistence/WS) but is its own class, not a shared abstraction
// (spec §3: round-engine internals are deliberately NOT unified between disciplines). Keyed by
// `roundNumber` instead of `windowStartMinute`, and — unlike soccer, where a separate
// SettlementEngine computes answers off a live event stream — this engine settles inline,
// because CS2 settlement is a single snapshot-diff at round end (settle.ts), not something that
// needs early-settle tracking across a window.
//
// Chronology this engine relies on (verified against a full recorded map, data-assumptions.md
// #1-#2): for round k, `cs2_round_lock(k)` (freezetime ends, round k goes live) always precedes
// `cs2_round_end(k)` (round k's score change) always precedes `cs2_round_lock(k+1)`. So at any
// moment at most one round is "open" (just generated at the prior lock) and at most one is
// "locked-awaiting-settlement" — the single-open-question invariant (spec §6) holds naturally.

import { randomUUID } from "node:crypto";
import type { Answer, Cs2SettlementCondition, IsoDateTime, MatchSignal, PredictionRound, Uuid } from "@arena/contracts";
import type { Cs2GameSnapshot } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { resolveCs2Settlement } from "./settle.js";
import { createCs2QuestionProvider, type Cs2QuestionProvider } from "./question-provider.js";
import { deriveRoundNumber } from "./snapshot.js";

export type Cs2RoundLifecycleEvent =
  | { type: "open"; round: PredictionRound }
  | { type: "lock"; roundId: Uuid; roundNumber: number }
  | { type: "settle"; roundId: Uuid; roundNumber: number; correctAnswer: Answer }
  | { type: "void"; roundId: Uuid; roundNumber: number };

export interface Cs2RoundEngineOptions {
  questionProvider?: Cs2QuestionProvider;
  teamNames?: { home: string; away: string };
  /** Persisted rounds restored before the bus starts delivering new signals. */
  initialRounds?: readonly PredictionRound[];
  /** True once the arena has finished. When set, no further rounds are opened — mirrors
   *  soccer's RoundEngineOptions.isArenaFinished. */
  isArenaFinished?: () => boolean;
  onTransition?: (event: Cs2RoundLifecycleEvent) => void;
}

export class Cs2RoundEngine {
  private readonly rounds = new Map<number, PredictionRound>();
  /** Baseline snapshot captured at each round's lock — the "before" half of its eventual diff
   *  (round-tracker.ts's `cs2_round_lock` signal carries only a round number, not a snapshot). */
  private readonly lockSnapshotByRound = new Map<number, Cs2GameSnapshot>();
  /** Most recent live snapshot seen (from `cs2_snapshot`), used at match end only when it proves
   *  the locked round's single score transition. */
  private lastLiveSnapshot: Cs2GameSnapshot | undefined;
  private readonly questionProvider: Cs2QuestionProvider;

  constructor(
    private readonly matchId: Uuid,
    private readonly arenaId: Uuid,
    private readonly options: Cs2RoundEngineOptions = {},
  ) {
    this.questionProvider = options.questionProvider ?? createCs2QuestionProvider();
    for (const round of options.initialRounds ?? []) {
      if (round.roundNumber === undefined || round.matchId !== matchId || round.arenaId !== arenaId) {
        throw new Error(`Invalid restored CS2 round ${round.id}`);
      }
      this.rounds.set(round.roundNumber, round);
    }
  }

  /** Rounds created so far, keyed by Round number (open, locked, settled, or voided). */
  get roundsByNumber(): ReadonlyMap<number, PredictionRound> {
    return this.rounds;
  }

  /** Opens Round 1's question (spec §7 крок 1). Not triggered by any `MatchSignal` — driven
   *  externally by whatever detects Match Live Detected (Arena lifecycle, step 4; a test/fixture
   *  driver until then). Takes the driving timestamp explicitly rather than reading the wall
   *  clock, so replaying a recorded fixture stays deterministic. */
  onMatchLiveDetected(timestamp: IsoDateTime): void {
    this.handleOpen(1, timestamp);
  }

  apply(signal: MatchSignal): void {
    switch (signal.kind) {
      case "cs2_snapshot":
        this.lastLiveSnapshot = signal.snapshot;
        return;
      case "cs2_round_lock":
        this.handleRoundLock(signal.roundNumber, signal.timestamp);
        return;
      case "cs2_round_end":
        this.handleRoundEnd(signal.roundNumber, signal.snapshot, signal.timestamp);
        return;
      case "cs2_match_end":
        this.handleMatchEnd(signal.timestamp);
        return;
      default:
        return; // soccer signals — this engine only reacts to CS2 ones.
    }
  }

  /** Subscribes to `bus`, applying every published signal. Returns an unsubscribe function. */
  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }

  private handleOpen(roundNumber: number, timestamp: IsoDateTime): void {
    if (this.rounds.has(roundNumber)) return; // idempotency guard — shouldn't happen, defensive

    const generated = this.questionProvider.generate({
      matchId: this.matchId,
      arenaId: this.arenaId,
      roundNumber,
      teamNames: this.options.teamNames,
    });

    const round: PredictionRound = {
      id: randomUUID(),
      arenaId: this.arenaId,
      matchId: this.matchId,
      discipline: "cs2",
      roundNumber,
      question: generated.question,
      settlementCondition: generated.settlementCondition,
      status: "open",
      openedAt: timestamp,
    };
    this.rounds.set(roundNumber, round);
    this.options.onTransition?.({ type: "open", round });
  }

  private handleRoundLock(roundNumber: number, timestamp: IsoDateTime): void {
    const round = this.rounds.get(roundNumber);
    if (round === undefined) {
      // The answer window for this real round was never observed, so it cannot fairly become a
      // prediction round. Neutralize stale earlier questions and resume with the next round,
      // whose answer window starts now.
      this.voidRemaining(roundNumber);
      if (this.options.isArenaFinished?.() !== true) this.handleOpen(roundNumber + 1, timestamp);
      return;
    }

    if (round.status === "open") {
      const locked: PredictionRound = { ...round, status: "locked", lockedAt: timestamp };
      this.rounds.set(roundNumber, locked);
      this.options.onTransition?.({ type: "lock", roundId: locked.id, roundNumber });
    }

    // This round's baseline for its own eventual cs2_round_end diff — the freshest live
    // snapshot as of this lock (cs2_snapshot for the same poll is always applied first, since
    // round-tracker.ts emits it before cs2_round_lock).
    if (this.lastLiveSnapshot !== undefined) {
      this.lockSnapshotByRound.set(roundNumber, this.lastLiveSnapshot);
    }

    if (this.options.isArenaFinished?.() === true) return; // game over — no further rounds
    this.handleOpen(roundNumber + 1, timestamp);
  }

  private handleRoundEnd(roundNumber: number, snapshotAfter: Cs2GameSnapshot, timestamp: IsoDateTime): void {
    const round = this.rounds.get(roundNumber);
    if (round === undefined || round.status !== "locked") return; // never locked (fallback-skip) or already settled/voided
    const condition = round.settlementCondition;
    if (condition.discipline !== "cs2") return; // defensive — this engine only ever creates cs2 rounds

    const before = this.lockSnapshotByRound.get(roundNumber);
    if (before === undefined) return; // no baseline captured — can't diff, skip rather than guess

    this.settle(roundNumber, round, condition, before, snapshotAfter, timestamp);
    this.lockSnapshotByRound.delete(roundNumber);
  }

  /**
   * Match end (`hasLiveGame() === false`, spec §4 крок 2 / §7 крок 3). Ordering per spec: (1)
   * settle a locked round only when the last live snapshot proves its one score transition,
   * then (2) void every unresolved round. If GRID removes the game before exposing the final
   * score, neutral voiding is safer than eliminating players from stale data.
   */
  private handleMatchEnd(timestamp: IsoDateTime): void {
    for (const [roundNumber, round] of this.rounds) {
      if (round.status !== "locked") continue;
      const condition = round.settlementCondition;
      if (condition.discipline !== "cs2") continue;
      const before = this.lockSnapshotByRound.get(roundNumber);
      if (before === undefined || this.lastLiveSnapshot === undefined) continue; // nothing to diff against — leave for the void pass below
      if (deriveRoundNumber(before) !== roundNumber || deriveRoundNumber(this.lastLiveSnapshot) !== roundNumber + 1) continue;
      this.settle(roundNumber, round, condition, before, this.lastLiveSnapshot, timestamp);
      this.lockSnapshotByRound.delete(roundNumber);
    }

    this.voidRemaining();

    this.lastLiveSnapshot = undefined;
    this.lockSnapshotByRound.clear();
  }

  /**
   * Voids every round still `open`/`locked` — the tail end of `handleMatchEnd`'s pass, but also
   * called directly once the Arena is declared decided by the single-survivor path
   * (`Cs2ArenaRuntime.flushFinishIfPending`), which can land many real rounds before
   * `cs2_match_end` itself. `isArenaFinished()` already stops *new* rounds from opening at the
   * next lock (`handleRoundLock`) — this stops the one round that's already in flight (open or
   * locked) at the moment the winner gets declared, per the cascading-generation overlap.
   */
  voidRemaining(throughRoundNumber = Number.POSITIVE_INFINITY): void {
    for (const [roundNumber, round] of this.rounds) {
      if (roundNumber > throughRoundNumber) continue;
      if (round.status !== "open" && round.status !== "locked") continue;
      const voided: PredictionRound = { ...round, status: "voided" };
      this.rounds.set(roundNumber, voided);
      this.lockSnapshotByRound.delete(roundNumber);
      this.options.onTransition?.({ type: "void", roundId: voided.id, roundNumber });
    }
  }

  private settle(
    roundNumber: number,
    round: PredictionRound,
    condition: Cs2SettlementCondition,
    before: Cs2GameSnapshot,
    after: Cs2GameSnapshot,
    timestamp: IsoDateTime,
  ): void {
    const correctAnswer = resolveCs2Settlement(condition, before, after);
    const settled: PredictionRound = {
      ...round,
      status: "settled",
      correctAnswer,
      settledAt: timestamp,
      settledBy: "round_end",
    };
    this.rounds.set(roundNumber, settled);
    this.options.onTransition?.({ type: "settle", roundId: settled.id, roundNumber, correctAnswer });
  }
}
