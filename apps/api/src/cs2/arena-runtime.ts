import type { Answer, ArenaPlayerStatus, IsoDateTime, PendingPrediction, PredictionRound, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import type {
  ArenaRuntimeLike,
  GatewayBroadcaster,
  RuntimeArenaPlayerStore,
  RuntimePredictionStore,
  SubmitAnswerOutcome,
} from "../gateway/arena-runtime.js";
import { LeaderboardService, type LeaderboardRosterEntry } from "../leaderboard/service.js";
import { applyRoundOutcome, type PlayerResultEvent } from "../settlement/apply-outcome.js";
import { Cs2RoundEngine, type Cs2RoundLifecycleEvent } from "./round-engine.js";
import type { Cs2QuestionProvider } from "./question-provider.js";

export interface Cs2ArenaPersistence {
  upsertRound(round: PredictionRound): void;
  finishArena(arenaId: Uuid, winners: Uuid[]): void;
}

export interface Cs2ArenaRuntimeOptions {
  matchId: Uuid;
  arenaId: Uuid;
  bus: MatchSignalBus;
  predictionStore: RuntimePredictionStore;
  arenaPlayerStore: RuntimeArenaPlayerStore;
  roster: LeaderboardRosterEntry[];
  broadcaster?: GatewayBroadcaster;
  persistence?: Cs2ArenaPersistence;
  teamNames?: { home: string; away: string };
  initialRounds?: readonly PredictionRound[];
  questionProvider?: Cs2QuestionProvider;
}

export class Cs2ArenaRuntime implements ArenaRuntimeLike {
  private readonly matchId: Uuid;
  private readonly arenaId: Uuid;
  private readonly predictionStore: RuntimePredictionStore;
  private readonly arenaPlayerStore: RuntimeArenaPlayerStore;
  private readonly broadcaster: GatewayBroadcaster | undefined;
  private readonly persistence: Cs2ArenaPersistence | undefined;

  private readonly roundEngine: Cs2RoundEngine;
  private readonly leaderboardService: LeaderboardService;

  private pendingPlayerStatus: PlayerResultEvent[] = [];
  private pendingWinners: Uuid[] | undefined;
  private winners: Uuid[] | undefined;
  private matchLiveDetectedAt: IsoDateTime | undefined;

  constructor(options: Cs2ArenaRuntimeOptions) {
    this.matchId = options.matchId;
    this.arenaId = options.arenaId;
    this.predictionStore = options.predictionStore;
    this.arenaPlayerStore = options.arenaPlayerStore;
    this.broadcaster = options.broadcaster;
    this.persistence = options.persistence;

    this.leaderboardService = new LeaderboardService(this.arenaId, options.roster, {
      onSnapshot: (entries) => this.broadcaster?.broadcast(this.arenaId, { type: "leaderboard.update", entries }),
      onFinished: (winners) => {
        this.pendingWinners = winners;
      },
    });

    this.roundEngine = new Cs2RoundEngine(this.matchId, this.arenaId, {
      ...(options.teamNames !== undefined ? { teamNames: options.teamNames } : {}),
      ...(options.questionProvider !== undefined ? { questionProvider: options.questionProvider } : {}),
      ...(options.initialRounds !== undefined ? { initialRounds: options.initialRounds } : {}),
      isArenaFinished: () => this.winners !== undefined,
      onTransition: (event) => this.onRoundTransition(event),
    });
    this.roundEngine.subscribeTo(options.bus);

    // Subscribe after the round engine so finalization sees the last settlement or void.
    options.bus.subscribe((signal) => {
      if (signal.kind !== "cs2_match_end") return;
      this.leaderboardService.finalize();
      this.flushFinishIfPending();
    });
  }

  openRoundOne(timestamp: IsoDateTime): void {
    this.roundEngine.onMatchLiveDetected(timestamp);
  }

  onMatchLiveDetected(timestamp: IsoDateTime): void {
    this.matchLiveDetectedAt ??= timestamp;
  }

  get currentRound(): PredictionRound | undefined {
    return [...this.roundEngine.roundsByNumber.values()]
      .filter((r) => r.status === "open" || r.status === "locked")
      .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0))[0];
  }

  leaderboardSnapshot() {
    return this.leaderboardService.snapshot();
  }

  finalWinners(): Uuid[] | undefined {
    return this.winners;
  }

  join(userId: Uuid, username: string, joinedAt: string = new Date().toISOString()): void {
    this.arenaPlayerStore.addPlayer(userId);
    this.leaderboardService.addPlayer({ userId, username, joinedAt });
  }

  statusFor(userId: Uuid): ArenaPlayerStatus | undefined {
    return this.arenaPlayerStore.getStatus(userId);
  }

  answerFor(userId: Uuid, roundId: Uuid): Answer | undefined {
    return this.predictionStore.getAnswers(roundId).get(userId);
  }

  /** Returns only the requesting player's answers. */
  pendingPredictionsFor(userId: Uuid): PendingPrediction[] {
    if (this.arenaPlayerStore.getStatus(userId) === "eliminated") return [];

    const pending: PendingPrediction[] = [];
    for (const round of this.roundEngine.roundsByNumber.values()) {
      if (round.status !== "locked") continue;
      const answer = this.predictionStore.getAnswers(round.id).get(userId);
      if (answer === undefined) continue;
      pending.push({
        roundId: round.id,
        question: round.question,
        roundNumber: round.roundNumber ?? 0,
        answer,
      });
    }
    return pending.sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0));
  }

  private pushPendingForAnswerers(roundId: Uuid): void {
    for (const userId of this.predictionStore.getAnswers(roundId).keys()) {
      this.broadcaster?.sendToUser(this.arenaId, userId, {
        type: "player.pending",
        predictions: this.pendingPredictionsFor(userId),
      });
    }
  }

  submitAnswer(userId: Uuid, roundId: Uuid, answer: Answer): SubmitAnswerOutcome {
    const round = [...this.roundEngine.roundsByNumber.values()].find((r) => r.id === roundId);
    if (round === undefined) return { ok: false, reason: "round_not_found" };
    if (round.status !== "open") return { ok: false, reason: "round_locked" };
    const playerStatus = this.arenaPlayerStore.getStatus(userId);
    if (playerStatus === undefined) return { ok: false, reason: "not_participant" };
    if (playerStatus !== "active") return { ok: false, reason: "eliminated" };

    const receivedAt = new Date();
    this.predictionStore.recordAnswer(roundId, userId, answer, receivedAt);
    return { ok: true, receivedAt: receivedAt.toISOString() };
  }

  private onRoundTransition(event: Cs2RoundLifecycleEvent): void {
    switch (event.type) {
      case "open":
        this.persistence?.upsertRound(event.round);
        this.broadcaster?.broadcast(this.arenaId, { type: "round.open", round: event.round });
        return;
      case "lock":
        this.handleLock(event.roundId, event.roundNumber);
        return;
      case "settle":
        this.handleSettle(event.roundId, event.roundNumber, event.correctAnswer);
        return;
      case "void":
        this.handleVoid(event.roundNumber);
        return;
    }
  }

  private handleLock(roundId: Uuid, roundNumber: number): void {
    const round = this.roundEngine.roundsByNumber.get(roundNumber);
    if (round === undefined) return;
    this.persistence?.upsertRound(round);

    const answers = this.predictionStore.getAnswers(roundId);
    const total = answers.size;
    const yesCount = [...answers.values()].filter((a) => a === "yes").length;
    // Broadcast aggregates only; individual answers remain private.
    const yesPct = total > 0 ? Math.round((yesCount / total) * 100) : 0;
    const noPct = total > 0 ? 100 - yesPct : 0;
    this.broadcaster?.broadcast(this.arenaId, {
      type: "round.lock",
      roundId,
      aggregate: { yesPct, noPct, total },
    });
    this.pushPendingForAnswerers(roundId);
  }

  private handleSettle(roundId: Uuid, roundNumber: number, correctAnswer: Answer): void {
    const round = this.roundEngine.roundsByNumber.get(roundNumber);
    if (round === undefined) return;
    this.persistence?.upsertRound(round);

    applyRoundOutcome(
      roundId,
      this.arenaId,
      correctAnswer,
      { predictionStore: this.predictionStore, arenaPlayerStore: this.arenaPlayerStore },
      (result) => this.onPlayerResult(result),
    );

    const survivorsCount = this.arenaPlayerStore.getActivePlayerIds(this.arenaId).length;
    this.broadcaster?.broadcast(this.arenaId, {
      type: "round.settle",
      roundId,
      question: round.question,
      correctAnswer,
      settledBy: "round_end",
      survivorsCount,
    });

    this.leaderboardService.onRoundSettled({ roundId });

    this.flushPendingPlayerStatus(roundId);
    this.flushFinishIfPending();
    this.pushPendingForAnswerers(roundId);
  }

  private handleVoid(roundNumber: number): void {
    const round = this.roundEngine.roundsByNumber.get(roundNumber);
    if (round === undefined) return;
    this.persistence?.upsertRound(round);
    this.broadcaster?.broadcast(this.arenaId, { type: "round.void", roundId: round.id });
  }

  private onPlayerResult(event: PlayerResultEvent): void {
    this.pendingPlayerStatus.push(event);
    this.leaderboardService.onPlayerResult(event);
  }

  private flushPendingPlayerStatus(roundId: Uuid): void {
    const events = this.pendingPlayerStatus;
    this.pendingPlayerStatus = [];
    for (const event of events) {
      this.broadcaster?.sendToUser(this.arenaId, event.userId, {
        type: "player.status",
        status: event.status,
        roundId,
      });
    }
  }

  private flushFinishIfPending(): void {
    if (this.pendingWinners === undefined) return;
    const winners = this.pendingWinners;
    this.pendingWinners = undefined;
    this.winners = winners;

    // A winner can be decided before GRID removes the map; stop the in-flight round.
    this.roundEngine.voidRemaining();

    this.broadcaster?.broadcast(this.arenaId, { type: "arena.finished", winners });
    this.persistence?.finishArena(this.arenaId, winners);
    for (const userId of winners) {
      this.broadcaster?.sendToUser(this.arenaId, userId, { type: "player.status", status: "winner" });
    }
  }
}
