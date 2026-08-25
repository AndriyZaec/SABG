// Settlement messages are emitted in state-transition order: settle, leaderboard, personal status,
// finish, then the refreshed pending snapshot.

import type {
  Answer,
  ArenaPlayerStatus,
  LeaderboardEntry,
  MatchPeriod,
  MatchState,
  PendingPrediction,
  PredictionResult,
  PredictionRound,
  Score,
  ServerMessage,
  Uuid,
} from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { logger } from "./logger.js";
import { MatchStateEngine } from "../match-state/engine.js";
import { RoundEngine, type RoundLifecycleEvent } from "../round-engine/engine.js";
import { createQuestionGenerator } from "../question-generator/engine.js";
import { SettlementEngine, type PlayerResultEvent, type SettlementEvent } from "../settlement/engine.js";
import type { PredictionStore } from "../settlement/prediction-store.js";
import type { ArenaPlayerStore } from "../settlement/arena-player-store.js";
import { LeaderboardService, type LeaderboardRosterEntry } from "../leaderboard/service.js";

export interface RuntimePredictionStore extends PredictionStore {
  recordAnswer(roundId: Uuid, userId: Uuid, answer: Answer, receivedAt: Date): void;
  getResult(roundId: Uuid, userId: Uuid): PredictionResult | undefined;
}

export interface RuntimeArenaPlayerStore extends ArenaPlayerStore {
  getStatus(userId: Uuid): ArenaPlayerStatus | undefined;
  addPlayer(userId: Uuid): void;
}

export interface GatewayBroadcaster {
  broadcast(arenaId: Uuid, message: ServerMessage): void;
  sendToUser(arenaId: Uuid, userId: Uuid, message: ServerMessage): void;
}

// Implementations must preserve callback order when persisting asynchronously.
export interface ArenaPersistence {
  updateMatchLive(matchId: Uuid, live: { currentMinute: number; period: MatchPeriod; score: Score }): void;
  upsertRound(round: PredictionRound): void;
  finishArena(arenaId: Uuid, winners: Uuid[]): void;
}

export interface ArenaRuntimeLike {
  readonly currentRound: PredictionRound | undefined;
  readonly matchState?: MatchState;
  join(userId: Uuid, username: string, joinedAt?: string): void;
  submitAnswer(userId: Uuid, roundId: Uuid, answer: Answer): SubmitAnswerOutcome;
  leaderboardSnapshot(): LeaderboardEntry[];
  finalWinners(): Uuid[] | undefined;
  statusFor?(userId: Uuid): ArenaPlayerStatus | undefined;
  pendingPredictionsFor?(userId: Uuid): PendingPrediction[];
  answerFor?(userId: Uuid, roundId: Uuid): Answer | undefined;
}

export interface ArenaRuntimeLookup {
  getRuntime(arenaId: Uuid): ArenaRuntimeLike | undefined;
}

export interface ArenaRuntimeOptions {
  matchId: Uuid;
  arenaId: Uuid;
  bus: MatchSignalBus;
  predictionStore: RuntimePredictionStore;
  arenaPlayerStore: RuntimeArenaPlayerStore;
  // Must describe the same active players as the hydrated store.
  roster: LeaderboardRosterEntry[];
  broadcaster: GatewayBroadcaster;
  persistence?: ArenaPersistence;
  // Must match the driver's pace or countdowns drift from lock timing.
  secondsPerMatchMinute?: number;
  teamNames?: { home: string; away: string };
}

export type SubmitAnswerOutcome =
  | { ok: true; receivedAt: string }
  | { ok: false; reason: "round_not_found" | "round_locked" | "eliminated" | "not_participant" };

export class ArenaRuntime implements ArenaRuntimeLike {
  private readonly matchId: Uuid;
  private readonly arenaId: Uuid;
  private readonly bus: MatchSignalBus;
  private readonly predictionStore: RuntimePredictionStore;
  private readonly arenaPlayerStore: RuntimeArenaPlayerStore;
  private readonly broadcaster: GatewayBroadcaster;
  private readonly persistence: ArenaPersistence | undefined;

  private readonly matchStateEngine: MatchStateEngine;
  private readonly roundEngine: RoundEngine;
  private settlementEngine!: SettlementEngine;
  private readonly leaderboardService: LeaderboardService;

  // Personal statuses flush only after the public settle and leaderboard messages.
  private pendingPlayerStatus: PlayerResultEvent[] = [];
  private pendingWinners: Uuid[] | undefined;
  private winners: Uuid[] | undefined;

  constructor(options: ArenaRuntimeOptions) {
    this.matchId = options.matchId;
    this.arenaId = options.arenaId;
    this.bus = options.bus;
    this.predictionStore = options.predictionStore;
    this.arenaPlayerStore = options.arenaPlayerStore;
    this.broadcaster = options.broadcaster;
    this.persistence = options.persistence;

    this.matchStateEngine = new MatchStateEngine(this.matchId, (state) => this.onMatchState(state));
    this.matchStateEngine.subscribeTo(this.bus);

    this.leaderboardService = new LeaderboardService(this.arenaId, options.roster, {
      onSnapshot: (entries) => this.onLeaderboardSnapshot(entries),
      onFinished: (winners) => {
        this.pendingWinners = winners;
      },
    });

    const questionGenerator = createQuestionGenerator();
    questionGenerator.subscribeTo(this.bus);

    this.roundEngine = new RoundEngine(this.matchId, this.arenaId, {
      getMatchState: () => this.matchStateEngine.snapshot,
      questionProvider: questionGenerator,
      ...(options.secondsPerMatchMinute !== undefined ? { secondsPerMatchMinute: options.secondsPerMatchMinute } : {}),
      ...(options.teamNames !== undefined ? { teamNames: options.teamNames } : {}),
      isArenaFinished: () => this.winners !== undefined,
      onTransition: (event) => this.onRoundTransition(event),
    });
    this.roundEngine.subscribeTo(this.bus);

    this.settlementEngine = new SettlementEngine(this.arenaId, {
      predictionStore: this.predictionStore,
      arenaPlayerStore: this.arenaPlayerStore,
      onSettled: (event) => this.onSettled(event),
      onPlayerResult: (event) => this.onPlayerResult(event),
    });
    this.settlementEngine.subscribeTo(this.bus);
  }

  get matchState(): MatchState {
    return this.matchStateEngine.snapshot;
  }

  get currentRound(): PredictionRound | undefined {
    return [...this.roundEngine.roundsByWindow.values()]
      .filter((r) => r.status === "open" || r.status === "locked")
      .sort((a, b) => (a.windowStartMinute ?? 0) - (b.windowStartMinute ?? 0))[0];
  }

  leaderboardSnapshot(): LeaderboardEntry[] {
    return this.leaderboardService.snapshot();
  }

  // Seating after the first lock would immediately score the new player as missed.
  hasLockedRound(): boolean {
    for (const round of this.roundEngine.roundsByWindow.values()) {
      if (round.status === "locked" || round.status === "settled") return true;
    }
    return false;
  }

  finalWinners(): Uuid[] | undefined {
    return this.winners;
  }

  join(userId: Uuid, username: string, joinedAt: string = new Date().toISOString()): void {
    this.arenaPlayerStore.addPlayer(userId);
    this.leaderboardService.addPlayer({ userId, username, joinedAt });
  }

  submitAnswer(userId: Uuid, roundId: Uuid, answer: Answer): SubmitAnswerOutcome {
    const round = [...this.roundEngine.roundsByWindow.values()].find((r) => r.id === roundId);
    if (round === undefined) return { ok: false, reason: "round_not_found" };
    if (round.status !== "open") return { ok: false, reason: "round_locked" };
    if (this.statusFor(userId) === "eliminated") return { ok: false, reason: "eliminated" };

    const receivedAt = new Date();
    this.predictionStore.recordAnswer(roundId, userId, answer, receivedAt);
    return { ok: true, receivedAt: receivedAt.toISOString() };
  }

  statusFor(userId: Uuid): ArenaPlayerStatus | undefined {
    return this.arenaPlayerStore.getStatus(userId);
  }

  answerFor(userId: Uuid, roundId: Uuid): Answer | undefined {
    return this.predictionStore.getAnswers(roundId).get(userId);
  }

  // Return only this user's answers; pending snapshots are private.
  pendingPredictionsFor(userId: Uuid): PendingPrediction[] {
    // Elimination immediately removes overlapping in-flight rounds from the player's view.
    if (this.statusFor(userId) === "eliminated") return [];

    const pending: PendingPrediction[] = [];
    for (const round of this.roundEngine.roundsByWindow.values()) {
      if (round.status !== "locked") continue;
      const answer = this.predictionStore.getAnswers(round.id).get(userId);
      if (answer === undefined) continue;
      pending.push({
        roundId: round.id,
        question: round.question,
        windowStartMinute: round.windowStartMinute ?? 0,
        windowEndMinute: round.windowEndMinute ?? 0,
        answer,
      });
    }
    return pending.sort((a, b) => (a.windowStartMinute ?? 0) - (b.windowStartMinute ?? 0));
  }

  private pushPendingForAnswerers(roundId: Uuid): void {
    for (const userId of this.predictionStore.getAnswers(roundId).keys()) {
      this.broadcaster.sendToUser(this.arenaId, userId, {
        type: "player.pending",
        predictions: this.pendingPredictionsFor(userId),
      });
    }
  }

  private onMatchState(state: MatchState): void {
    this.broadcaster.broadcast(this.arenaId, { type: "match.state", state });
    this.persistence?.updateMatchLive(this.matchId, {
      currentMinute: state.currentMinute,
      period: state.period,
      score: state.score,
    });

    if (state.period === "full_time") {
      this.leaderboardService.finalize();
      this.flushFinishIfPending();
    }
  }

  private onRoundTransition(event: RoundLifecycleEvent): void {
    if (event.type === "open") {
      this.persistence?.upsertRound(event.round);
      this.broadcaster.broadcast(this.arenaId, { type: "round.open", round: event.round, lockAt: event.lockAt });
      return;
    }

    const round = this.roundEngine.roundsByWindow.get(event.windowStartMinute);
    if (round === undefined) return;

    this.settlementEngine.onRoundLocked(round);
    this.persistence?.upsertRound(round);

    const answers = this.predictionStore.getAnswers(round.id);
    const total = answers.size;
    const yesCount = [...answers.values()].filter((a) => a === "yes").length;
    // Broadcast only aggregates; individual answers remain private.
    const yesPct = total > 0 ? Math.round((yesCount / total) * 100) : 0;
    const noPct = total > 0 ? 100 - yesPct : 0;
    this.broadcaster.broadcast(this.arenaId, {
      type: "round.lock",
      roundId: round.id,
      aggregate: { yesPct, noPct, total },
    });
    this.pushPendingForAnswerers(round.id);
  }

  private onSettled(event: SettlementEvent): void {
    const settled = this.roundEngine.markSettled(event.windowStartMinute, event.correctAnswer, event.settledBy);
    if (settled !== undefined) this.persistence?.upsertRound(settled);

    const survivorsCount = this.arenaPlayerStore.getActivePlayerIds(this.arenaId).length;
    this.broadcaster.broadcast(this.arenaId, {
      type: "round.settle",
      roundId: event.roundId,
      question: settled?.question ?? "",
      correctAnswer: event.correctAnswer,
      settledBy: event.settledBy,
      survivorsCount,
    });

    // Apply the round atomically before flushing personal and finish messages.
    this.leaderboardService.onRoundSettled(event);

    this.flushPendingPlayerStatus(event.roundId);
    this.flushFinishIfPending();
    this.pushPendingForAnswerers(event.roundId);
  }

  private onPlayerResult(event: PlayerResultEvent): void {
    this.pendingPlayerStatus.push(event);
    this.leaderboardService.onPlayerResult(event);
  }

  private onLeaderboardSnapshot(entries: LeaderboardEntry[]): void {
    this.broadcaster.broadcast(this.arenaId, { type: "leaderboard.update", entries });
  }

  private flushPendingPlayerStatus(roundId: Uuid): void {
    const events = this.pendingPlayerStatus;
    this.pendingPlayerStatus = [];
    for (const event of events) {
      this.broadcaster.sendToUser(this.arenaId, event.userId, {
        type: "player.status",
        status: event.status,
        roundId,
      });
      // Clear overlapping in-flight rounds as soon as participation ends.
      if (event.status === "eliminated") {
        this.broadcaster.sendToUser(this.arenaId, event.userId, {
          type: "player.pending",
          predictions: this.pendingPredictionsFor(event.userId),
        });
      }
    }
  }

  private flushFinishIfPending(): void {
    if (this.pendingWinners === undefined) return;
    const winners = this.pendingWinners;
    this.pendingWinners = undefined;
    this.winners = winners;

    logger.info(
      { arenaId: this.arenaId, winners },
      "arena finished — winners declared; halting round creation",
    );

    this.broadcaster.broadcast(this.arenaId, { type: "arena.finished", winners });
    this.persistence?.finishArena(this.arenaId, winners);
    for (const userId of winners) {
      this.broadcaster.sendToUser(this.arenaId, userId, { type: "player.status", status: "winner" });
    }
  }
}
