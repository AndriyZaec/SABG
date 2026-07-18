// The arena runtime: wires one arena's engine set (all reused unchanged) onto a fresh
// MatchSignalBus, and connects every engine callback to (a) persistence and (b) a broadcast
// port. This is the piece the mock server scripted by hand; here the real engines drive it off
// whatever publishes onto `bus` (a recorded replay or run.ts's live worker
// later — the runtime itself is source-agnostic).
//
// Message-ordering note: within one round's settle, this runtime emits, in this order:
//   round.settle -> leaderboard.update -> player.status (this round's active/eliminated, personal)
//   -> [only if the arena just finished] arena.finished -> player.status:"winner" (personal, per winner)
//   -> player.pending (personal, per answerer of this round — trails everything else; see
//      pushPendingForAnswerers). The same personal player.pending refresh also fires right after
//      round.lock, so each answerer sees a round added on lock and dropped on settle.
// The mock's scripted timeline never interleaves a mid-round finish with its per-round messages
// (it always finishes after a fixed round count), so there's no existing precedent to match here;
// this ordering is a deliberate choice (settle before its own leaderboard effects; winner-only
// messages last) documented so gateway/__tests__/arena-runtime.test.ts can assert it exactly.

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

/** The engine-facing `PredictionStore` plus the extra ops the gateway itself needs. */
export interface RuntimePredictionStore extends PredictionStore {
  recordAnswer(roundId: Uuid, userId: Uuid, answer: Answer, receivedAt: Date): void;
  getResult(roundId: Uuid, userId: Uuid): PredictionResult | undefined;
}

/** The engine-facing `ArenaPlayerStore` plus the extra ops the gateway's join flow needs. */
export interface RuntimeArenaPlayerStore extends ArenaPlayerStore {
  getStatus(userId: Uuid): ArenaPlayerStatus | undefined;
  addPlayer(userId: Uuid): void;
}

/** Broadcast port — ws.ts implements this against real connections; tests can inject a spy. */
export interface GatewayBroadcaster {
  broadcast(arenaId: Uuid, message: ServerMessage): void;
  sendToUser(arenaId: Uuid, userId: Uuid, message: ServerMessage): void;
}

/**
 * Async persistence, called synchronously (fire-and-forget) from engine callbacks. The prod
 * implementation (gateway/run.ts) enqueues each call onto the per-arena WriteQueue
 * (gateway/stores/write-queue.ts) so writes stay ordered and a failure is logged, not thrown.
 * Tests omit this entirely — the DoD doesn't require a database.
 */
export interface ArenaPersistence {
  updateMatchLive(matchId: Uuid, live: { currentMinute: number; period: MatchPeriod; score: Score }): void;
  upsertRound(round: PredictionRound): void;
  finishArena(arenaId: Uuid, winners: Uuid[]): void;
}

/**
 * Shared lookup port: rest.ts needs to reach a running arena's live state (matchState,
 * currentRound, leaderboard snapshot, join/submitAnswer) without importing the concrete WS class.
 * `GatewayWebSocketServer` (ws.ts) is the one registry in this gateway and satisfies this
 * structurally — both rest.ts and ws.ts share that single instance (wired in gateway/run.ts).
 */
export interface ArenaRuntimeLookup {
  getRuntime(arenaId: Uuid): ArenaRuntime | undefined;
}

export interface ArenaRuntimeOptions {
  matchId: Uuid;
  arenaId: Uuid;
  bus: MatchSignalBus;
  predictionStore: RuntimePredictionStore;
  arenaPlayerStore: RuntimeArenaPlayerStore;
  /** Initial roster — must describe the same active players as `arenaPlayerStore`'s hydration. */
  roster: LeaderboardRosterEntry[];
  broadcaster: GatewayBroadcaster;
  persistence?: ArenaPersistence;
  /** Real seconds per match-minute for the countdown projection — must match the driver's pace. */
  secondsPerMatchMinute?: number;
  /** Real home/away team names, forwarded to the RoundEngine/QuestionProvider so questions read
   *  "England" instead of "home". Falls back to "Home"/"Away" when omitted. */
  teamNames?: { home: string; away: string };
}

export type SubmitAnswerOutcome =
  | { ok: true; receivedAt: string }
  | { ok: false; reason: "round_not_found" | "round_locked" | "eliminated" };

export class ArenaRuntime {
  private readonly matchId: Uuid;
  private readonly arenaId: Uuid;
  private readonly bus: MatchSignalBus;
  private readonly predictionStore: RuntimePredictionStore;
  private readonly arenaPlayerStore: RuntimeArenaPlayerStore;
  private readonly broadcaster: GatewayBroadcaster;
  private readonly persistence: ArenaPersistence | undefined;

  private readonly matchStateEngine: MatchStateEngine;
  private readonly roundEngine: RoundEngine;
  private settlementEngine!: SettlementEngine; // assigned in constructor before any signal can fire
  private readonly leaderboardService: LeaderboardService;

  /** This round's buffered personal statuses — flushed after round.settle + leaderboard.update. */
  private pendingPlayerStatus: PlayerResultEvent[] = [];
  /** Set by leaderboardService's onFinished, flushed (arena.finished + winner statuses) by the
   *  caller that triggered it (round-settle or matchState-full-time) — see the ordering note above. */
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

  /** Current match snapshot, for REST GET /arenas/:id and WS resync on (re)subscribe. */
  get matchState(): MatchState {
    return this.matchStateEngine.snapshot;
  }

  /** The in-progress round (open or locked), if any — for REST/WS resync. */
  get currentRound(): PredictionRound | undefined {
    return [...this.roundEngine.roundsByWindow.values()]
      .filter((r) => r.status === "open" || r.status === "locked")
      .sort((a, b) => a.windowStartMinute - b.windowStartMinute)[0];
  }

  leaderboardSnapshot(): LeaderboardEntry[] {
    return this.leaderboardService.snapshot();
  }

  /**
   * True once any round has locked — from that point a newly-seated player has already missed an
   * answerable round (locked rounds can no longer be answered, and are scored "missed" at settle).
   * Gates the join grace window: a buy started in the lobby may still be seated during `live` up to
   * the first lock, not past it.
   */
  hasLockedRound(): boolean {
    for (const round of this.roundEngine.roundsByWindow.values()) {
      if (round.status === "locked" || round.status === "settled") return true;
    }
    return false;
  }

  finalWinners(): Uuid[] | undefined {
    return this.winners;
  }

  /**
   * Seat a player. Allowed pre-kickoff or during the live grace window before the first round
   * locks — the caller (rest.ts's /entry/submit) enforces that via `hasLockedRound()`.
   */
  join(userId: Uuid, username: string, joinedAt: string = new Date().toISOString()): void {
    this.arenaPlayerStore.addPlayer(userId);
    this.leaderboardService.addPlayer({ userId, username, joinedAt });
  }

  /** Shared by REST POST /rounds/:id/answer and the WS `answer` message. */
  submitAnswer(userId: Uuid, roundId: Uuid, answer: Answer): SubmitAnswerOutcome {
    const round = [...this.roundEngine.roundsByWindow.values()].find((r) => r.id === roundId);
    if (round === undefined) return { ok: false, reason: "round_not_found" };
    if (round.status !== "open") return { ok: false, reason: "round_locked" };
    if (this.statusFor(userId) === "eliminated") return { ok: false, reason: "eliminated" };

    const receivedAt = new Date();
    this.predictionStore.recordAnswer(roundId, userId, answer, receivedAt);
    return { ok: true, receivedAt: receivedAt.toISOString() };
  }

  /** The player's current status, if known — used to gate submitAnswer and to resync a
   *  reconnecting client's own status (WS subscribe), since player.status is otherwise only
   *  ever pushed live, right after the round that changed it settles. */
  statusFor(userId: Uuid): ArenaPlayerStatus | undefined {
    return this.arenaPlayerStore.getStatus(userId);
  }

  /**
   * The player's own pending predictions: every round that has locked but not yet settled and
   * for which this user submitted an answer. Multiple can be in flight at once (settlement is
   * per-window). Pure read over roundsByWindow + the answer cache — used both for the
   * `player.pending` WS push on lock/settle and the GET /arenas/:id reconnect snapshot.
   * Spec §8: only ever this user's own answer, never others'.
   */
  pendingPredictionsFor(userId: Uuid): PendingPrediction[] {
    // An eliminated player holds no live rounds — even one they legitimately answered while still
    // active (the round overlap window: they can answer round N+1 before round N settles and
    // eliminates them). Without this, "Awaiting results" would keep showing that round as if they
    // were still in it, and it would quietly resolve for them at settle (spectator-only from here).
    if (this.statusFor(userId) === "eliminated") return [];

    const pending: PendingPrediction[] = [];
    for (const round of this.roundEngine.roundsByWindow.values()) {
      if (round.status !== "locked") continue;
      const answer = this.predictionStore.getAnswers(round.id).get(userId);
      if (answer === undefined) continue;
      pending.push({
        roundId: round.id,
        question: round.question,
        windowStartMinute: round.windowStartMinute,
        windowEndMinute: round.windowEndMinute,
        answer,
      });
    }
    return pending.sort((a, b) => a.windowStartMinute - b.windowStartMinute);
  }

  /** Re-push the personal pending snapshot to every user who answered `roundId` — call whenever
   *  that round enters or leaves the locked-unsettled set (lock / settle). */
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

    // "lock"
    const round = this.roundEngine.roundsByWindow.get(event.windowStartMinute);
    if (round === undefined) return;

    this.settlementEngine.onRoundLocked(round);
    this.persistence?.upsertRound(round);

    const answers = this.predictionStore.getAnswers(round.id);
    const total = answers.size;
    const yesCount = [...answers.values()].filter((a) => a === "yes").length;
    // Spectator privacy (spec §8): only ever the aggregate, never individual answers.
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

    // Applies this round's buffered PlayerResultEvents atomically; may synchronously trigger
    // onLeaderboardSnapshot (leaderboard.update) and set pendingWinners (see class doc comment).
    this.leaderboardService.onRoundSettled(event);

    this.flushPendingPlayerStatus(event.roundId);
    this.flushFinishIfPending();
    // markSettled (above) already flipped this round's status, so pendingPredictionsFor no
    // longer includes it — each answerer's refreshed snapshot shows it dropped off.
    this.pushPendingForAnswerers(event.roundId);
  }

  /**
   * The two consumers of a settled player's outcome, owned in one place so neither can be added
   * later without the other: the personal WS notification (buffered until this round's
   * round.settle) and the leaderboard's own score/status bookkeeping (live/run.ts wires the same
   * pair by hand at its composition root; here it's a single method on the one object that
   * already holds both).
   */
  private onPlayerResult(event: PlayerResultEvent): void {
    this.pendingPlayerStatus.push(event);
    this.leaderboardService.onPlayerResult(event);
  }

  private onLeaderboardSnapshot(entries: LeaderboardEntry[]): void {
    this.broadcaster.broadcast(this.arenaId, { type: "leaderboard.update", entries });
  }

  /** Sends each buffered PlayerResultEvent from the just-settled round as a personal status. */
  private flushPendingPlayerStatus(roundId: Uuid): void {
    const events = this.pendingPlayerStatus;
    this.pendingPlayerStatus = [];
    for (const event of events) {
      this.broadcaster.sendToUser(this.arenaId, event.userId, {
        type: "player.status",
        status: event.status,
        roundId,
      });
      // Elimination is final for participation: clear any in-flight round(s) this player had
      // answered while still active (round overlap — see pendingPredictionsFor) right away,
      // rather than leaving them in "Awaiting results" until each of those rounds settles too.
      if (event.status === "eliminated") {
        this.broadcaster.sendToUser(this.arenaId, event.userId, {
          type: "player.pending",
          predictions: this.pendingPredictionsFor(event.userId),
        });
      }
    }
  }

  /** Broadcasts arena.finished + a personal "winner" status per winner, if a finish is pending. */
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
