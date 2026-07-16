// S2 — REST request/response DTOs (build plan §S2, P0.4).
// The mock server and the real API both implement these shapes.

import type { Answer } from "./enums.js";
import type {
  Arena,
  ArenaPlayer,
  LeaderboardEntry,
  Match,
  MatchState,
  Prediction,
  PredictionRound,
  TxSignature,
  User,
  Uuid,
  WalletAddress,
} from "./entities.js";

/** POST /auth/nonce — request a fresh nonce to embed in the sign-in message. */
export interface WalletNonceRequest {
  walletAddress: WalletAddress;
}
export interface WalletNonceResponse {
  nonce: string;
}

/** POST /auth/wallet — sign-in with Solana. */
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

/** GET /arenas?matchId= — list the arena(s) running against a match (lobby discovery). */
export interface ArenaListResponse {
  arenas: Arena[];
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

/**
 * Backend-orchestrated entry (atomic pay ⇒ seat). The user signs once; the backend builds and
 * submits the on-chain buy, so a payment can never land without a seat.
 *
 * POST /arenas/:id/entry/prepare — backend builds the unsigned buy_entry tx (lobby only).
 */
export interface PrepareEntryRequest {
  walletAddress: string;
}
export interface PrepareEntryResponse {
  prepareId: Uuid;
  /** Base64 unsigned transaction for the wallet to sign. */
  tx: string;
}

/** POST /arenas/:id/entry/submit — backend submits the signed tx, seats the player, issues a token. */
export interface SubmitEntryRequest {
  prepareId: Uuid;
  /** Base64 tx signed by the user's wallet. */
  signedTx: string;
}
export interface SubmitEntryResponse {
  token: string;
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

/**
 * GET /arenas/:id/rounds (history/summary — F4 Match Summary). One entry per round created for
 * the arena, in window order. `predictions` is only ever populated for a `settled` round — open
 * or locked rounds report an empty array, since individual answers are never revealed before
 * settle (spec §8).
 */
export interface RoundWithPredictions {
  round: PredictionRound;
  predictions: Prediction[];
}
export interface ArenaRoundsResponse {
  rounds: RoundWithPredictions[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
