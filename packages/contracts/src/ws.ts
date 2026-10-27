// Never expose personal answers to spectators before settlement.

import type { Answer, ArenaCancelledReason, PredictionResult, SettledBy } from "./enums.js";
import type {
  LeaderboardEntry,
  MatchState,
  PredictionRound,
  RoundSurvivalRule,
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
  survivalRuleApplied?: RoundSurvivalRule;
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

/** Classic arenas only, after every settled round: the server's zone, or Final Circle once it starts. */
export type ArenaZoneMessage =
  | {
      type: "arena.zone";
      stage: "zone";
      /** Zone after the last settled round. */
      zone: number;
      /** Zone after the next round to settle. */
      nextZone: number;
    }
  | {
      type: "arena.zone";
      stage: "final_circle";
      /** First round played under Final Circle rules. */
      fromRound: number;
    };

/** Terminal cancellation of an arena that will not go live. */
export interface ArenaCancelledMessage {
  type: "arena.cancelled";
  reason: ArenaCancelledReason;
}

export interface RoundVoidMessage {
  type: "round.void";
  roundId: Uuid;
  /** CS2 question number; omitted by legacy soccer. */
  roundNumber?: number;
}

/** Personal state; send only to the addressed connection. */
export interface PlayerStatusMessage {
  type: "player.status";
  status: "active" | "eliminated" | "winner";
  roundId?: Uuid;
}

/** Personal; sent after every settled round to each player who was active when it started. */
export interface PlayerResultMessage {
  type: "player.result";
  roundId: Uuid;
  roundNumber: number;
  /** null when the player did not answer. */
  answer: Answer | null;
  result: PredictionResult;
  /** What the round added to the score (classic double rounds give 2, Final Circle 1). */
  points: number;
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
  | ArenaZoneMessage
  | PlayerStatusMessage
  | PlayerResultMessage
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

/** Validate untrusted JSON before dispatching it as a client message. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) return false;
  switch (value.type) {
    case "subscribe":
      return "arenaId" in value && typeof value.arenaId === "string" && value.arenaId.trim().length > 0;
    case "answer":
      return "roundId" in value && typeof value.roundId === "string" && value.roundId.trim().length > 0
        && "answer" in value && (value.answer === "yes" || value.answer === "no");
    default:
      return false;
  }
}
