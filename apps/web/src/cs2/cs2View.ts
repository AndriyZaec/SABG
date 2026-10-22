import type {
  Answer,
  AnswerRejectionReason,
  ArenaCancelledReason,
  ArenaMode,
  ArenaPlayerStatus,
  ArenaStage,
  PendingPrediction,
  RoundStatus,
  RoundSurvivalRule,
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
  survivalRuleApplied?: RoundSurvivalRule;
}

export type Cs2AnswerSubmission =
  | { status: "idle" }
  | { status: "submitting"; roundId: string; answer: Answer }
  | { status: "accepted"; roundId: string; answer: Answer }
  | { status: "rejected"; roundId: string; answer: Answer; reason: AnswerRejectionReason };

export interface Cs2ArenaView {
  mode: ArenaMode;
  /** Classic only; switched by `arena.stage`. */
  stage: ArenaStage;
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
  /** Finishing is terminal; no more rounds open in this arena. */
  finished?: true;
  feed: FeedItem[];
  leaderboard: LeaderRow[];
}
