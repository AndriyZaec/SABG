import type {
  Answer,
  ArenaCancelledReason,
  ArenaPlayerStatus,
  ArenaStatus,
  Discipline,
  EntryPassStatus,
  MatchPeriod,
  MatchStatus,
  PayoutStatus,
  PredictionResult,
  RoundStatus,
  SeriesStatus,
  SettledBy,
  TargetEventType,
  TeamSide,
} from "./enums.js";
import type { Cs2TeamIdentity, SettlementCondition } from "./settlement.js";

export type IsoDateTime = string;
export type Uuid = string;
export type WalletAddress = string;
export type TxSignature = string;

export interface Score {
  home: number;
  away: number;
}

export interface User {
  id: Uuid;
  walletAddress: WalletAddress;
  username: string;
  avatar?: string;
}

interface BaseMatch {
  id: Uuid;
  startTime: IsoDateTime;
  status: MatchStatus;
}

export interface SoccerMatch extends BaseMatch {
  discipline: "soccer";
  homeTeam: string;
  awayTeam: string;
  currentMinute: number;
  period: MatchPeriod;
  score: Score;
}

export interface Cs2MatchTeamScore extends Cs2TeamIdentity {
  score: number;
}

export interface Cs2Match extends BaseMatch {
  discipline: "cs2";
  seriesId: Uuid;
  /** Stable 1-based map position within the series. */
  seriesMatchIndex: number;
  teamScores: [Cs2MatchTeamScore, Cs2MatchTeamScore];
}

export type Match = SoccerMatch | Cs2Match;

/** Groups map-level matches; each arena belongs to one map-level match. */
export interface Series {
  id: Uuid;
  gridSeriesId: string;
  format: number;
  scheduledStartTime: IsoDateTime;
  status: SeriesStatus;
}

export interface Arena {
  id: Uuid;
  matchId: Uuid;
  status: ArenaStatus;
  activePlayersCount: number;
  entryFeeLamports: number;
  prizePoolLamports: number;
  escrowAccount: WalletAddress;
  /** Absent until the arena is provisioned on-chain. */
  onchainArenaId?: number;
  /** Present only for terminal cancellation. */
  cancelledReason?: ArenaCancelledReason;
}

export interface EntryPass {
  id: Uuid;
  arenaId: Uuid;
  userId: Uuid;
  walletAddress: WalletAddress;
  amountLamports: number;
  txSignature: TxSignature;
  status: EntryPassStatus;
  purchasedAt: IsoDateTime;
}

export interface ArenaPlayer {
  id: Uuid;
  arenaId: Uuid;
  userId: Uuid;
  status: ArenaPlayerStatus;
  score: number;
  joinedAt: IsoDateTime;
  eliminatedRoundId?: Uuid;
}

export interface PredictionRound {
  id: Uuid;
  arenaId: Uuid;
  matchId: Uuid;
  discipline: Discipline;
  /** Soccer only. */
  windowStartMinute?: number;
  windowEndMinute?: number;
  /** CS2 only. */
  roundNumber?: number;
  question: string;
  /** Soccer only. */
  targetEventType?: TargetEventType;
  targetTeam?: TeamSide;
  settlementCondition: SettlementCondition;
  status: RoundStatus;
  correctAnswer?: Answer;
  openedAt?: IsoDateTime;
  lockedAt?: IsoDateTime;
  settledAt?: IsoDateTime;
  settledBy?: SettledBy;
}

export interface Prediction {
  id: Uuid;
  roundId: Uuid;
  userId: Uuid;
  answer: Answer;
  answeredAt: IsoDateTime;
  /** Authoritative receive time for reconnect conflict resolution. */
  receivedAt: IsoDateTime;
  result?: PredictionResult;
}

export interface LiveEvent {
  id: Uuid;
  matchId: Uuid;
  eventType: TargetEventType;
  team: TeamSide;
  matchMinute: number;
  timestamp: IsoDateTime;
  confirmed: boolean;
  rawPayload?: unknown;
}

export interface Payout {
  id: Uuid;
  arenaId: Uuid;
  userId: Uuid;
  amountLamports: number;
  txSignature?: TxSignature;
  status: PayoutStatus;
}

export interface MatchState {
  matchId: Uuid;
  period: MatchPeriod;
  currentMinute: number;
  score: Score;
  possession?: TeamSide;
  shots: Score;
  corners: Score;
  cards: Score;
  activeWindowStartMinute?: number;
}

export interface LeaderboardEntry {
  userId: Uuid;
  username: string;
  status: ArenaPlayerStatus;
  score: number;
  avgAnswerMs?: number;
  missedCount: number;
  joinedAt: IsoDateTime;
  rank?: number;
}
