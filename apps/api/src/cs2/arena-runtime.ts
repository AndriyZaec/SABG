import { cs2ClassicZoneAfter } from "@arena/contracts";
import type {
  Answer,
  ArenaMode,
  ArenaPlayerStatus,
  Cs2TeamIdentity,
  IsoDateTime,
  PendingPrediction,
  PredictionRound,
  RoundSurvivalRule,
  Uuid,
} from "@arena/contracts";
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
import { resolveClassicRound } from "../settlement/classic-outcome.js";
import { Cs2RoundEngine, type Cs2RoundLifecycleEvent } from "./round-engine.js";
import type { Cs2QuestionProvider } from "./question-provider.js";

export interface Cs2ArenaPersistence {
  upsertRound(round: PredictionRound): void;
  finishArena(arenaId: Uuid, winners: Uuid[]): void;
  /** Classic: the first round played under Final Circle rules. */
  startFinalCircle(arenaId: Uuid, fromRound: number): void;
}

export interface Cs2ArenaRuntimeOptions {
  matchId: Uuid;
  arenaId: Uuid;
  mode: ArenaMode;
  bus: MatchSignalBus;
  predictionStore: RuntimePredictionStore;
  arenaPlayerStore: RuntimeArenaPlayerStore;
  roster: LeaderboardRosterEntry[];
  broadcaster?: GatewayBroadcaster;
  persistence?: Cs2ArenaPersistence;
  teams?: readonly [Cs2TeamIdentity, Cs2TeamIdentity];
  initialRounds?: readonly PredictionRound[];
  questionProvider?: Cs2QuestionProvider;
}

export class Cs2ArenaRuntime implements ArenaRuntimeLike {
  private readonly matchId: Uuid;
  private readonly arenaId: Uuid;
  readonly mode: ArenaMode;
  /** Classic only: set once Final Circle starts; hardcore never sets it. */
  private finalCircleFromRound: number | undefined;
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
    this.mode = options.mode;
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
      ...(options.teams !== undefined ? { teams: options.teams } : {}),
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

  openRoundOne(
    timestamp: IsoDateTime,
    teams?: readonly [Cs2TeamIdentity, Cs2TeamIdentity],
  ): void {
    this.roundEngine.onMatchLiveDetected(timestamp, teams);
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

    const survivalRuleApplied = this.mode === "classic"
      ? this.settleClassic(roundId, roundNumber, correctAnswer)
      : applyRoundOutcome(
        roundId,
        this.arenaId,
        correctAnswer,
        { predictionStore: this.predictionStore, arenaPlayerStore: this.arenaPlayerStore },
        (result) => this.onPlayerResult(result),
        { noCorrectAnswers: "continue" },
      );
    if (survivalRuleApplied !== undefined) round.survivalRuleApplied = survivalRuleApplied;
    this.persistence?.upsertRound(round);

    const survivorsCount = this.arenaPlayerStore.getActivePlayerIds(this.arenaId).length;
    this.broadcaster?.broadcast(this.arenaId, {
      type: "round.settle",
      roundId,
      question: round.question,
      correctAnswer,
      settledBy: "round_end",
      survivorsCount,
      ...(survivalRuleApplied !== undefined ? { survivalRuleApplied } : {}),
    });

    this.leaderboardService.onRoundSettled({ roundId, roundNumber });

    this.flushPendingPlayerStatus(roundId, roundNumber);
    this.flushFinishIfPending();
    this.pushPendingForAnswerers(roundId);
  }

  /** Same side effects as `applyRoundOutcome`; scores before this round come from the leaderboard. */
  private settleClassic(roundId: Uuid, roundNumber: number, correctAnswer: Answer): RoundSurvivalRule | undefined {
    const scores = new Map(this.leaderboardService.snapshot().map((entry) => [entry.userId, entry.score]));
    const outcome = resolveClassicRound({
      roundNumber,
      stage: this.finalCircleFromRound === undefined ? "zone" : "final_circle",
      players: this.arenaPlayerStore.getActivePlayerIds(this.arenaId).map((userId) => ({ userId, score: scores.get(userId) ?? 0 })),
      answers: this.predictionStore.getAnswers(roundId),
      correctAnswer,
    });

    for (const { userId, answer, result, points, status } of outcome.results) {
      this.predictionStore.recordResult(roundId, userId, result);
      this.arenaPlayerStore.setStatus(userId, status, roundId);
      this.onPlayerResult({ roundId, userId, answer, result, points, status });
    }
    if (outcome.stage === "final_circle" && this.finalCircleFromRound === undefined) {
      this.finalCircleFromRound = roundNumber + 1;
      this.persistence?.startFinalCircle(this.arenaId, this.finalCircleFromRound);
    }
    this.broadcaster?.broadcast(this.arenaId, this.finalCircleFromRound !== undefined
      ? { type: "arena.zone", stage: "final_circle", fromRound: this.finalCircleFromRound }
      : { type: "arena.zone", stage: "zone", zone: cs2ClassicZoneAfter(roundNumber), nextZone: cs2ClassicZoneAfter(roundNumber + 1) });
    return outcome.survivalRuleApplied;
  }

  private handleVoid(roundNumber: number): void {
    const round = this.roundEngine.roundsByNumber.get(roundNumber);
    if (round === undefined) return;
    this.persistence?.upsertRound(round);
    this.broadcaster?.broadcast(this.arenaId, { type: "round.void", roundId: round.id, roundNumber });
  }

  private onPlayerResult(event: PlayerResultEvent): void {
    this.pendingPlayerStatus.push(event);
    this.leaderboardService.onPlayerResult(event);
  }

  private flushPendingPlayerStatus(roundId: Uuid, roundNumber: number): void {
    const events = this.pendingPlayerStatus;
    this.pendingPlayerStatus = [];
    for (const event of events) {
      this.broadcaster?.sendToUser(this.arenaId, event.userId, {
        type: "player.status",
        status: event.status,
        roundId,
      });
      this.broadcaster?.sendToUser(this.arenaId, event.userId, {
        type: "player.result",
        roundId,
        roundNumber,
        answer: event.answer ?? null,
        result: event.result,
        points: event.points,
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

    // Queued before the payout, so the DB shows the winners once the arena is paid.
    for (const userId of winners) this.arenaPlayerStore.setStatus(userId, "winner");
    this.broadcaster?.broadcast(this.arenaId, { type: "arena.finished", winners });
    this.persistence?.finishArena(this.arenaId, winners);
    for (const userId of winners) {
      this.broadcaster?.sendToUser(this.arenaId, userId, { type: "player.status", status: "winner" });
    }
  }
}
