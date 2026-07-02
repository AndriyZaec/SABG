// Entity types — direct mapping of spec v2 §13 Data Models.
// These are the persisted/domain shapes shared by API, engines and frontend.

import type {
  Answer,
  ArenaPlayerStatus,
  ArenaStatus,
  EntryPassStatus,
  MatchPeriod,
  MatchStatus,
  PayoutStatus,
  PredictionResult,
  RoundStatus,
  SettledBy,
  TargetEventType,
  TeamSide,
} from "./enums.js";
import type { SettlementCondition } from "./settlement.js";

/** ISO-8601 timestamp string. */
export type IsoDateTime = string;
export type Uuid = string;
/** Base-58 Solana address. */
export type WalletAddress = string;
/** Base-58 Solana transaction signature. */
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

export interface Match {
  id: Uuid;
  homeTeam: string;
  awayTeam: string;
  startTime: IsoDateTime;
  status: MatchStatus;
  /** Current minute incl. stoppage (match clock, spec §3.1). */
  currentMinute: number;
  period: MatchPeriod;
  score: Score;
}

export interface Arena {
  id: Uuid;
  matchId: Uuid;
  status: ArenaStatus;
  activePlayersCount: number;
  entryFeeLamports: number;
  prizePoolLamports: number;
  /** On-chain escrow PDA address. */
  escrowAccount: WalletAddress;
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
  windowStartMinute: number;
  windowEndMinute: number;
  question: string;
  targetEventType: TargetEventType;
  targetTeam: TeamSide;
  settlementCondition: SettlementCondition;
  status: RoundStatus;
  correctAnswer?: Answer;
  /** T - leadTime (leadTime >= 60s), spec §5. */
  openedAt?: IsoDateTime;
  /** Exactly window start T, spec §5. */
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
  /** When backend received it — source of truth for reconnect tie-break (spec §9). */
  receivedAt: IsoDateTime;
  result?: PredictionResult;
}

export interface LiveEvent {
  id: Uuid;
  matchId: Uuid;
  eventType: TargetEventType;
  team: TeamSide;
  /** Match minute incl. stoppage. */
  matchMinute: number;
  timestamp: IsoDateTime;
  /** provisional (false) vs confirmed (true) — spec §5.1. */
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

/** Aggregated match state maintained by the Match State Engine (B2). */
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

/** A single ranked entry in the leaderboard (spec §7). */
export interface LeaderboardEntry {
  userId: Uuid;
  username: string;
  status: ArenaPlayerStatus;
  score: number;
  /** Avg (answeredAt - openedAt) ms — tie-breaker 1. */
  avgAnswerMs?: number;
  missedCount: number;
  joinedAt: IsoDateTime;
  rank?: number;
}
