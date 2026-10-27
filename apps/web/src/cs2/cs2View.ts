import type {
  Answer,
  AnswerRejectionReason,
  ArenaCancelledReason,
  ArenaMode,
  ArenaPlayerStatus,
  ArenaZoneMessage,
  Cs2TeamIdentity,
  PendingPrediction,
  RoundStatus,
  RoundSurvivalRule,
} from "@arena/contracts";
import type { LeaderRow } from "../arena/arenaView.js";
import type { Cs2FeedRound, Cs2RoundResult } from "./live/cs2Feed.js";

export type { LeaderRow };

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
  /** Classic only: the server's latest zone; zone 0 / next 0 until the first one arrives. */
  zone: ArenaZoneMessage;
  teams?: readonly [string, string];
  /** The map's teams, for short questions in the feed. */
  teamIdentities: readonly Cs2TeamIdentity[];
  /** Classic: first round under Final Circle rules, from the arena or `arena.zone`. */
  finalCircleFromRound?: number;
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
  /** Every round the feed knows about: the history on load, kept current by round messages. */
  rounds: Cs2FeedRound[];
  /** The viewer's own results that arrived live (`player.result`), by round id. */
  liveResults: Record<string, Cs2RoundResult>;
  leaderboard: LeaderRow[];
}
