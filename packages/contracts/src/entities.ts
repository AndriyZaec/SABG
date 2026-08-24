// Entity types — direct mapping of spec v2 §13 Data Models.
// These are the persisted/domain shapes shared by API, engines and frontend.

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
  /** Game type; selects round engine/question-provider/ingestion (cs2-migration-spec/spec_v2.md §2-§3). */
  discipline: Discipline;
  homeTeam: string;
  awayTeam: string;
  startTime: IsoDateTime;
  status: MatchStatus;
  /** Current minute incl. stoppage (match clock, spec §3.1). Soccer-only — unused for CS2. */
  currentMinute: number;
  period: MatchPeriod;
  score: Score;
  /**
   * FK to a `Series` (cs2-migration-spec/spec_v2.md §2). CS2: one entry per map. Disciplines
   * without series structure (soccer) leave this empty.
   */
  seriesId?: Uuid;
  /** Stable 1-based map position inside a CS2 Series. Absent for soccer. */
  seriesMatchIndex?: number;
}

/**
 * `best-of-N` grouping of `Match` rows, one per map — mirrors GRID `seriesState`
 * (cs2-migration-spec/spec_v2.md §2). NOT an Arena — Arena is always at the single-Match level.
 */
export interface Series {
  id: Uuid;
  /** GRID's own series id, as passed to `seriesState(id: "...")`. */
  gridSeriesId: string;
  /** Best-of-N, 1-7 (spec §2). GRID reports this as a "best-of-N" string — parsed at ingestion. */
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
  /** On-chain escrow PDA address. */
  escrowAccount: WalletAddress;
  /** Numeric id used as the on-chain program's `arena_id` PDA seed. Absent until provisioned. */
  onchainArenaId?: number;
  /** Set only when `status === "cancelled"` (CS2 no-show / forfeit-cancellation). */
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
  /** Soccer only (5-min match-clock windows, spec §5). Absent for CS2. */
  windowStartMinute?: number;
  windowEndMinute?: number;
  /**
   * CS2 only: the real Round number this PredictionRound is 1:1 with
   * (cs2-migration-spec/spec_v2.md §2, §7). Absent for soccer.
   */
  roundNumber?: number;
  question: string;
  /** Soccer only — CS2 rounds carry their topic inside `settlementCondition` instead. */
  targetEventType?: TargetEventType;
  targetTeam?: TeamSide;
  settlementCondition: SettlementCondition;
  status: RoundStatus;
  correctAnswer?: Answer;
  /** T - leadTime (leadTime >= 60s), spec §5. Soccer only — CS2 has no minimum window (spec §6). */
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
