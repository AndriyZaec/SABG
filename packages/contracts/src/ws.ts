// Never expose personal answers to spectators before settlement.

import type { Answer, ArenaCancelledReason, SettledBy } from "./enums.js";
import type {
  LeaderboardEntry,
  MatchState,
  PredictionRound,
  Uuid,
} from "./entities.js";

export interface RoundOpenMessage {
  type: "round.open";
  round: PredictionRound;
  /** Soccer only; CS2 has no fixed lock time. */
  lockAt?: string;
}

export interface RoundLockMessage {
  type: "round.lock";
  roundId: Uuid;
  /** Aggregate only; never expose personal answers here. */
  aggregate: { yesPct: number; noPct: number; total: number };
}

export interface RoundSettleMessage {
  type: "round.settle";
  roundId: Uuid;
  question: string;
  correctAnswer: Answer;
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

/** Terminal cancellation of an arena that will not go live. */
export interface ArenaCancelledMessage {
  type: "arena.cancelled";
  reason: ArenaCancelledReason;
}

export interface RoundVoidMessage {
  type: "round.void";
  roundId: Uuid;
}

/** Personal state; send only to the addressed connection. */
export interface PlayerStatusMessage {
  type: "player.status";
  status: "active" | "eliminated" | "winner";
  roundId?: Uuid;
}

/** Personal answer state. Soccer uses minute windows; CS2 uses round numbers. */
export interface PendingPrediction {
  roundId: Uuid;
  question: string;
  windowStartMinute?: number;
  windowEndMinute?: number;
  roundNumber?: number;
  answer: Answer;
}

/** Authoritative personal snapshot; replace prior reconnect state. */
export interface PlayerPendingMessage {
  type: "player.pending";
  predictions: PendingPrediction[];
}

export interface AnswerAcceptedMessage {
  type: "answer.accepted";
  roundId: Uuid;
  answer: Answer;
  receivedAt: string;
}

/** Authoritative current-round answer state, sent on subscribe/reconnect. */
export interface AnswerSnapshotMessage {
  type: "answer.snapshot";
  roundId: Uuid;
  answer: Answer | null;
}

export type AnswerRejectionReason =
  | "not_subscribed"
  | "arena_not_found"
  | "round_not_found"
  | "round_locked"
  | "eliminated"
  | "not_participant";

export interface AnswerRejectedMessage {
  type: "answer.rejected";
  roundId: Uuid;
  answer: Answer;
  reason: AnswerRejectionReason;
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
  | PlayerPendingMessage
  | AnswerAcceptedMessage
  | AnswerSnapshotMessage
  | AnswerRejectedMessage;

export interface SubscribeMessage {
  type: "subscribe";
  arenaId: Uuid;
}

export interface AnswerMessage {
  type: "answer";
  roundId: Uuid;
  answer: Answer;
}

export type ClientMessage = SubscribeMessage | AnswerMessage;
