// S2 — WebSocket message catalog (build plan §S2, B7).
// Realtime push from Realtime Gateway -> clients, plus a few client->server messages.
// Spectator privacy (spec §8): live answers are NEVER pushed before lock; after lock
// only aggregates (yes%/no%); individual answers only after settle.

import type { Answer, Uuid } from "./enums.js";
import type {
  LeaderboardEntry,
  MatchState,
  PredictionRound,
} from "./entities.js";

// ---- Server -> Client -------------------------------------------------------

export interface RoundOpenMessage {
  type: "round.open";
  round: PredictionRound;
  /** Absolute lock time (window start T). Client counts down to this. */
  lockAt: string;
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
  correctAnswer: Answer;
  settledBy: "early" | "window_end";
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

/** Personal, addressed to a single connection (survived/eliminated). */
export interface PlayerStatusMessage {
  type: "player.status";
  status: "active" | "eliminated" | "winner";
  roundId?: Uuid;
}

export type ServerMessage =
  | RoundOpenMessage
  | RoundLockMessage
  | RoundSettleMessage
  | MatchStateMessage
  | LeaderboardMessage
  | ArenaFinishedMessage
  | PlayerStatusMessage;

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
