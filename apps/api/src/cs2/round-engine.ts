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

export type Cs2RoundLifecycleEvent =
  | { type: "open"; round: PredictionRound }
  | { type: "lock"; roundId: Uuid; roundNumber: number }
  | { type: "settle"; roundId: Uuid; roundNumber: number; correctAnswer: Answer }
  | { type: "void"; roundId: Uuid; roundNumber: number };

export interface Cs2RoundEngineOptions {
  questionProvider?: Cs2QuestionProvider;
  teamNames?: { home: string; away: string };
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
  /** Most recent live snapshot seen (from `cs2_snapshot`), kept as the best-available "after"
   *  for the match-end fallback settle (spec §7 п.3's risk note — see handleMatchEnd). */
  private lastLiveSnapshot: Cs2GameSnapshot | undefined;
  private readonly questionProvider: Cs2QuestionProvider;

  constructor(
    private readonly matchId: Uuid,
    private readonly arenaId: Uuid,
    private readonly options: Cs2RoundEngineOptions = {},
  ) {
    this.questionProvider = options.questionProvider ?? createCs2QuestionProvider();
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
      // Q(roundNumber) was never opened — either Round 1's lock arrived before
      // onMatchLiveDetected() ran (fallback: skip entirely, no cascade to start from), or this
      // is a defensive no-op for a round number the cascade never reached. Either way there's
      // nothing to lock and nothing to cascade into, so don't open the next round either.
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
   * settle the round currently in flight — the one whose lock we saw but whose score-change
   * round_end never arrived, most likely the deciding round — from the best snapshot available
   * (the last live one seen), *then* (2) void every round that never got a result. This is the
   * data-risk spec §9 п.2 flags (a decisive kill and `finished:true` landing in the same ~10s
   * poll window can mean no snapshot ever shows the final score) — diffing against the last
   * known snapshot is the honest fallback, not a guess dressed up as certainty. Tracked as an
   * open assumption in cs2-migration-spec/data-assumptions.md #5.
   */
  private handleMatchEnd(timestamp: IsoDateTime): void {
    for (const [roundNumber, round] of this.rounds) {
      if (round.status !== "locked") continue;
      const condition = round.settlementCondition;
      if (condition.discipline !== "cs2") continue;
      const before = this.lockSnapshotByRound.get(roundNumber);
      if (before === undefined || this.lastLiveSnapshot === undefined) continue; // nothing to diff against — leave for the void pass below
      this.settle(roundNumber, round, condition, before, this.lastLiveSnapshot, timestamp);
      this.lockSnapshotByRound.delete(roundNumber);
    }

    for (const [roundNumber, round] of this.rounds) {
      if (round.status !== "open" && round.status !== "locked") continue;
      const voided: PredictionRound = { ...round, status: "voided" };
      this.rounds.set(roundNumber, voided);
      this.options.onTransition?.({ type: "void", roundId: voided.id, roundNumber });
    }

    this.lastLiveSnapshot = undefined;
    this.lockSnapshotByRound.clear();
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
