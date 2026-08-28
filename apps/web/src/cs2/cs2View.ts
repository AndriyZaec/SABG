import type {
  Answer,
  AnswerRejectionReason,
  ArenaCancelledReason,
  ArenaPlayerStatus,
  PendingPrediction,
  RoundStatus,
} from "@arena/contracts";
import type { FeedItem, LeaderRow } from "../arena/arenaView.js";

export type { FeedItem, LeaderRow };

export interface Cs2RoundView {
  roundId: string;
  roundNumber: number;
  question: string;
  status: RoundStatus;
  myAnswer?: Answer;
  correctAnswer?: Answer;
}

export type Cs2AnswerSubmission =
  | { status: "idle" }
  | { status: "submitting"; roundId: string; answer: Answer }
  | { status: "accepted"; roundId: string; answer: Answer }
  | { status: "rejected"; roundId: string; answer: Answer; reason: AnswerRejectionReason };

export interface Cs2ArenaView {
  teams?: readonly [string, string];
  seriesFormat?: number;
  survivors: number;
  totalPlayers: number;
  round?: Cs2RoundView;
  /** Undefined until personal state is received or restored on reconnect. */
  myStatus?: ArenaPlayerStatus;
  /** Authoritative snapshot of this player's locked, unsettled predictions. */
  pendingPredictions?: PendingPrediction[];
  /** Cancellation is terminal; the arena will not go live. */
  cancelled?: { reason: ArenaCancelledReason };
  feed: FeedItem[];
  leaderboard: LeaderRow[];
}
