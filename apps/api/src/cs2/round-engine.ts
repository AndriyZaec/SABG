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
  initialRounds?: readonly PredictionRound[];
  isArenaFinished?: () => boolean;
  onTransition?: (event: Cs2RoundLifecycleEvent) => void;
}

export class Cs2RoundEngine {
  private readonly rounds = new Map<number, PredictionRound>();
  /** Baseline captured at lock for the eventual round-end diff. */
  private readonly lockSnapshotByRound = new Map<number, Cs2GameSnapshot>();
  /** Used at match end only when it proves one score transition. */
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

  get roundsByNumber(): ReadonlyMap<number, PredictionRound> {
    return this.rounds;
  }

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
        return;
    }
  }

  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }

  private handleOpen(roundNumber: number, timestamp: IsoDateTime): void {
    if (this.rounds.has(roundNumber)) return;

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
      // Do not create a prediction for an answer window the feed never observed.
      this.voidRemaining(roundNumber);
      if (this.options.isArenaFinished?.() !== true) this.handleOpen(roundNumber + 1, timestamp);
      return;
    }

    if (round.status === "open") {
      const locked: PredictionRound = { ...round, status: "locked", lockedAt: timestamp };
      this.rounds.set(roundNumber, locked);
      this.options.onTransition?.({ type: "lock", roundId: locked.id, roundNumber });
    }

    // The same poll's snapshot is emitted before its lock signal.
    if (this.lastLiveSnapshot !== undefined) {
      this.lockSnapshotByRound.set(roundNumber, this.lastLiveSnapshot);
    }

    if (this.options.isArenaFinished?.() === true) return;
    this.handleOpen(roundNumber + 1, timestamp);
  }

  private handleRoundEnd(roundNumber: number, snapshotAfter: Cs2GameSnapshot, timestamp: IsoDateTime): void {
    const round = this.rounds.get(roundNumber);
    if (round === undefined || round.status !== "locked") return;
    const condition = round.settlementCondition;
    if (condition.discipline !== "cs2") return;

    const before = this.lockSnapshotByRound.get(roundNumber);
    if (before === undefined) return;

    this.settle(roundNumber, round, condition, before, snapshotAfter, timestamp);
    this.lockSnapshotByRound.delete(roundNumber);
  }

  /** Settles only a proven final transition, then neutrally voids unresolved rounds. */
  private handleMatchEnd(timestamp: IsoDateTime): void {
    for (const [roundNumber, round] of this.rounds) {
      if (round.status !== "locked") continue;
      const condition = round.settlementCondition;
      if (condition.discipline !== "cs2") continue;
      const before = this.lockSnapshotByRound.get(roundNumber);
      if (before === undefined || this.lastLiveSnapshot === undefined) continue;
      if (deriveRoundNumber(before) !== roundNumber || deriveRoundNumber(this.lastLiveSnapshot) !== roundNumber + 1) continue;
      this.settle(roundNumber, round, condition, before, this.lastLiveSnapshot, timestamp);
      this.lockSnapshotByRound.delete(roundNumber);
    }

    this.voidRemaining();

    this.lastLiveSnapshot = undefined;
    this.lockSnapshotByRound.clear();
  }

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
