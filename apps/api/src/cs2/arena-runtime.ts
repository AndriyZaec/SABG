// CS2's arena runtime — the CS2 analog of gateway/arena-runtime.ts, reusing that file's ports
// (RuntimePredictionStore/RuntimeArenaPlayerStore/GatewayBroadcaster/SubmitAnswerOutcome — spec
// §3 says round-engine *internals* stay discipline-specific, not the join/answer/elimination
// plumbing around them) rather than redeclaring them. Wired directly into cs2/round-engine.ts's
// Cs2RoundLifecycleEvent stream instead of soccer's two-stage RoundEngine+SettlementEngine split:
// CS2 settlement already happened *inside* Cs2RoundEngine by the time its "settle" event fires
// (a single snapshot-diff, spec §7), so this runtime only has to apply the outcome
// (settlement/apply-outcome.ts — the same discipline-agnostic elimination step soccer's
// SettlementEngine uses), not compute it.
//
// Round 1's open/lock split (data-assumptions.md #13, TASK.md step-4 design decision):
// `openRoundOne` opens Q(R1) at Arena creation, not at Match Live Detected — the caller (Series
// lifecycle, series-lifecycle.ts's `open_arena` action) drives it from the lobby-creation path.
// `onMatchLiveDetected` therefore does *not* open anything (Cs2RoundEngine.onMatchLiveDetected
// would be a no-op the second time regardless — handleOpen's idempotency guard — but this runtime
// never calls it twice to begin with): it exists purely as a marker for the join-gate/reconnect
// concerns 4b's persistence layer will read.
//
// Deliberately deferred to 4b (persistence/WS wiring step, see TASK.md and
// data-assumptions.md's "Design gaps surfaced by real data"): broadcasting `round.open` — its
// message type (ws.ts's RoundOpenMessage) requires an absolute `lockAt`, which CS2 fundamentally
// doesn't have (spec §6: "мінімальної тривалості answer window немає") — and `player.pending`
// (PendingPrediction requires windowStartMinute/windowEndMinute, soccer-only fields). Both are
// real contract gaps, not oversights here; fixing ws.ts is out of this step's scope.

import type { Answer, IsoDateTime, PredictionRound, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import type {
  GatewayBroadcaster,
  RuntimeArenaPlayerStore,
  RuntimePredictionStore,
  SubmitAnswerOutcome,
} from "../gateway/arena-runtime.js";
import { LeaderboardService, type LeaderboardRosterEntry } from "../leaderboard/service.js";
import { applyRoundOutcome, type PlayerResultEvent } from "../settlement/apply-outcome.js";
import { Cs2RoundEngine, type Cs2RoundLifecycleEvent } from "./round-engine.js";
import type { Cs2QuestionProvider } from "./question-provider.js";

/** CS2 equivalent of gateway/arena-runtime.ts's ArenaPersistence — narrower, since CS2 has no
 *  soccer-style match clock to persist (updateMatchLive) and finishArena lands with 4b's actual
 *  Arena-status/payout wiring. */
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
  /** Initial roster — must describe the same active players as `arenaPlayerStore`'s hydration. */
  roster: LeaderboardRosterEntry[];
  /** Omitted in tests / until 4b wires a real WS server. */
  broadcaster?: GatewayBroadcaster;
  persistence?: Cs2ArenaPersistence;
  teamNames?: { home: string; away: string };
  /** Forwarded to Cs2RoundEngine — defaults to createCs2QuestionProvider() there. Overridable
   *  seam for tests that need deterministic questions (the real provider picks randomly, spec
   *  §7 п.7 / §10). */
  questionProvider?: Cs2QuestionProvider;
}

export class Cs2ArenaRuntime {
  private readonly matchId: Uuid;
  private readonly arenaId: Uuid;
  private readonly predictionStore: RuntimePredictionStore;
  private readonly arenaPlayerStore: RuntimeArenaPlayerStore;
  private readonly broadcaster: GatewayBroadcaster | undefined;
  private readonly persistence: Cs2ArenaPersistence | undefined;

  private readonly roundEngine: Cs2RoundEngine;
  private readonly leaderboardService: LeaderboardService;

  /** This round's buffered personal statuses — flushed right after its settle + leaderboard.update. */
  private pendingPlayerStatus: PlayerResultEvent[] = [];
  private pendingWinners: Uuid[] | undefined;
  private winners: Uuid[] | undefined;
  /** Set once by `onMatchLiveDetected` — a marker for 4b's join-gate/reconnect concerns, not
   *  consulted by this runtime itself (Round 1 is already open by the time this fires). */
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
      isArenaFinished: () => this.winners !== undefined,
      onTransition: (event) => this.onRoundTransition(event),
    });
    this.roundEngine.subscribeTo(options.bus);
  }

  /** Opens Round 1 (spec §7 крок 1) — called from the Arena-creation path (Series lifecycle's
   *  `open_arena` action, series-lifecycle.ts), not from Match Live Detected (see file header). */
  openRoundOne(timestamp: IsoDateTime): void {
    this.roundEngine.onMatchLiveDetected(timestamp);
  }

  /** Marks Match Live Detected for join-gate/reconnect purposes. Round 1 is already open by now
   *  (openRoundOne) — this does not touch the round engine. */
  onMatchLiveDetected(timestamp: IsoDateTime): void {
    this.matchLiveDetectedAt ??= timestamp;
  }

  /** The in-progress round (open or locked), if any — mirrors gateway/arena-runtime.ts's
   *  currentRound, sorted by roundNumber instead of windowStartMinute. */
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

  submitAnswer(userId: Uuid, roundId: Uuid, answer: Answer): SubmitAnswerOutcome {
    const round = [...this.roundEngine.roundsByNumber.values()].find((r) => r.id === roundId);
    if (round === undefined) return { ok: false, reason: "round_not_found" };
    if (round.status !== "open") return { ok: false, reason: "round_locked" };
    if (this.arenaPlayerStore.getStatus(userId) === "eliminated") return { ok: false, reason: "eliminated" };

    const receivedAt = new Date();
    this.predictionStore.recordAnswer(roundId, userId, answer, receivedAt);
    return { ok: true, receivedAt: receivedAt.toISOString() };
  }

  private onRoundTransition(event: Cs2RoundLifecycleEvent): void {
    switch (event.type) {
      case "open":
        this.persistence?.upsertRound(event.round);
        // round.open broadcast deferred to 4b — see file header (lockAt contract gap).
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
    // Spectator privacy (spec §8): only ever the aggregate, never individual answers.
    const yesPct = total > 0 ? Math.round((yesCount / total) * 100) : 0;
    const noPct = total > 0 ? 100 - yesPct : 0;
    this.broadcaster?.broadcast(this.arenaId, {
      type: "round.lock",
      roundId,
      aggregate: { yesPct, noPct, total },
    });
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

    // Applies this round's buffered PlayerResultEvents atomically; may synchronously trigger
    // onSnapshot (leaderboard.update) and set pendingWinners.
    this.leaderboardService.onRoundSettled({ roundId });

    this.flushPendingPlayerStatus(roundId);
    this.flushFinishIfPending();
  }

  private handleVoid(roundNumber: number): void {
    const round = this.roundEngine.roundsByNumber.get(roundNumber);
    if (round === undefined) return;
    this.persistence?.upsertRound(round);
    // Voided is neutral (spec §7 п.3): no elimination, no leaderboard effect, no broadcast type
    // exists for it yet — persistence-only for now (4b's WS-gap note, file header).
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

    this.broadcaster?.broadcast(this.arenaId, { type: "arena.finished", winners });
    this.persistence?.finishArena(this.arenaId, winners);
    for (const userId of winners) {
      this.broadcaster?.sendToUser(this.arenaId, userId, { type: "player.status", status: "winner" });
    }
  }
}
