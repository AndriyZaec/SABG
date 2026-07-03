// S2 — REST request/response DTOs (build plan §S2, P0.4).
// The mock server and the real API both implement these shapes.

import type { Answer } from "./enums.js";
import type {
  Arena,
  ArenaPlayer,
  LeaderboardEntry,
  Match,
  MatchState,
  PredictionRound,
  TxSignature,
  User,
  Uuid,
  WalletAddress,
} from "./entities.js";

/** POST /auth/wallet — sign-in with Solana (C5). */
export interface WalletSignInRequest {
  walletAddress: WalletAddress;
  /** Base-58 signature over the issued nonce/message. */
  signature: string;
  message: string;
}
export interface WalletSignInResponse {
  token: string;
  user: User;
}

/** GET /matches, GET /matches/:id */
export interface MatchListResponse {
  matches: Match[];
}

/** GET /arenas/:id */
export interface ArenaDetailResponse {
  arena: Arena;
  match: Match;
  matchState?: MatchState;
  currentRound?: PredictionRound;
}

/**
 * POST /arenas/:id/entry — confirm an on-chain entry purchase.
 * FE submits the buy tx on-chain (C1) then reports the signature here.
 */
export interface BuyEntryRequest {
  txSignature: TxSignature;
}
export interface BuyEntryResponse {
  entryPassId: Uuid;
  player: ArenaPlayer;
  arena: Arena;
}

/** POST /rounds/:id/answer — submit/change answer while round is open (spec §5, §9). */
export interface SubmitAnswerRequest {
  answer: Answer;
}
export interface SubmitAnswerResponse {
  roundId: Uuid;
  answer: Answer;
  /** Server receive time — authoritative for lock/reconnect (spec §9). */
  receivedAt: string;
}

/** GET /arenas/:id/leaderboard */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  winners?: Uuid[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
