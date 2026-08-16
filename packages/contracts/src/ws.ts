// S2 — WebSocket message catalog (build plan §S2, B7).
// Realtime push from Realtime Gateway -> clients, plus a few client->server messages.
// Spectator privacy (spec §8): live answers are NEVER pushed before lock; after lock
// only aggregates (yes%/no%); individual answers only after settle.

import type { Answer, ArenaCancelledReason, SettledBy } from "./enums.js";
import type {
  LeaderboardEntry,
  MatchState,
  PredictionRound,
  Uuid,
} from "./entities.js";

// ---- Server -> Client -------------------------------------------------------

export interface RoundOpenMessage {
  type: "round.open";
  round: PredictionRound;
  /**
   * Absolute lock time (window start T), for soccer's fixed 5-min windows. Absent for CS2 rounds
   * (cs2-migration-spec/spec_v2.md §6: "мінімальної тривалості answer window немає" — the lock
   * time depends on when freezetime ends, unknowable in advance). A client should show a
   * countdown when present and an unbounded "open" indicator when not.
   */
  lockAt?: string;
}

export interface RoundLockMessage {
  type: "round.lock";
  roundId: Uuid;
  /** Aggregate only — safe to reveal post-lock (spec §8). */
  aggregate: { yesPct: number; noPct: number; total: number };
}

export interface RoundSettleMessage {
  type: "round.settle";
  roundId: Uuid;
  /** The question that was answered, so the feed can show what YES/NO refers to. */
  question: string;
  correctAnswer: Answer;
  /**
   * Was `"early" | "window_end"` inline (soccer-only values). Widened to the shared `SettledBy`
   * enum (which now also has CS2's `"round_end"`) to avoid duplicating the union — this message
   * type is soccer-only in practice (soccer's SettlementEngine never emits `"round_end"`), the
   * wider type just tracks the canonical source of truth instead of re-declaring a subset of it.
   */
  settledBy: SettledBy;
  survivorsCount: number;
}

export interface MatchStateMessage {
  type: "match.state";
  state: MatchState;
}

export interface LeaderboardMessage {
  type: "leaderboard.update";
  entries: LeaderboardEntry[];
}

export interface ArenaFinishedMessage {
  type: "arena.finished";
  winners: Uuid[];
}

/**
 * CS2 no-show (spec §4 п.4) or Arena #k+1 forfeit-cancellation (data-assumptions.md #12) — the
 * Arena never went live and never will. No `PredictionRound` was ever open, so there's nothing to
 * void; this is the arena-level counterpart to `RoundVoidMessage` below.
 */
export interface ArenaCancelledMessage {
  type: "arena.cancelled";
  reason: ArenaCancelledReason;
}

/**
 * A `PredictionRound` that was generated (spec §7 п.3, cascading generation) but never opened for
 * play because the Match ended first — CS2-only (`RoundStatus`'s `"voided"`). Neutral: no
 * elimination, no leaderboard effect: this message exists purely so a client that already saw
 * this round via `round.open` learns not to expect a `round.lock`/`round.settle` for it.
 */
export interface RoundVoidMessage {
  type: "round.void";
  roundId: Uuid;
}

/** Personal, addressed to a single connection (survived/eliminated). */
export interface PlayerStatusMessage {
  type: "player.status";
  status: "active" | "eliminated" | "winner";
  roundId?: Uuid;
}

/** One locked-but-unsettled round the player has answered (spec §8: their own answer only).
 *  `windowStartMinute`/`windowEndMinute` are soccer-only, `roundNumber` is CS2-only — same
 *  discipline-tagged-optional-fields pattern `PredictionRound` (entities.ts) already uses, not a
 *  discriminated union. */
export interface PendingPrediction {
  roundId: Uuid;
  question: string;
  windowStartMinute?: number;
  windowEndMinute?: number;
  roundNumber?: number;
  answer: Answer;
}

/** Personal snapshot of the player's own pending (locked, unsettled) predictions. */
export interface PlayerPendingMessage {
  type: "player.pending";
  predictions: PendingPrediction[];
}

export type ServerMessage =
  | RoundOpenMessage
  | RoundLockMessage
  | RoundSettleMessage
  | RoundVoidMessage
  | MatchStateMessage
  | LeaderboardMessage
  | ArenaFinishedMessage
  | ArenaCancelledMessage
  | PlayerStatusMessage
  | PlayerPendingMessage;

// ---- Client -> Server -------------------------------------------------------

export interface SubscribeMessage {
  type: "subscribe";
  arenaId: Uuid;
}

/** Answering over WS (REST /rounds/:id/answer is the equivalent fallback). */
export interface AnswerMessage {
  type: "answer";
  roundId: Uuid;
  answer: Answer;
}

export type ClientMessage = SubscribeMessage | AnswerMessage;
