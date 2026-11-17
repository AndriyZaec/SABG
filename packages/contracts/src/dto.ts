// S2 — REST request/response DTOs (build plan §S2, P0.4).
// The mock server and the real API both implement these shapes.

import type { Answer, ArenaCancelledReason, ArenaStatus, Cs2SeriesArenaForecast, Cs2SeriesLifecycle } from "./enums.js";
import type {
  Arena,
  ArenaPlayer,
  IsoDateTime,
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

export type GameSourceMode = "catalog" | "replay" | "live";

/** GET /api/runtime-config — public display metadata, never secrets. */
export interface RuntimeConfigResponse {
  gameSource: GameSourceMode;
  sourceLabel: string;
}

/** GET /api/access/session — event-level visibility gate, separate from wallet identity. */
export type EventAccessSessionResponse =
  | { status: "not_required" }
  | { status: "authenticated" }
  | { status: "unauthenticated" };

/** POST /api/access/session — exchange the shared event code for a secure session cookie. */
export interface EventAccessSignInRequest {
  code: string;
}

/** POST /auth/nonce — request the server-issued sign-in challenge. */
export interface WalletNonceRequest {
  walletAddress: WalletAddress;
}
export interface WalletNonceResponse {
  nonce: string;
  /** Exact canonical text to sign, including the server's domain and timestamps. */
  message: string;
  expiresAt: IsoDateTime;
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

export interface Cs2TeamSummary {
  id: Uuid;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export type Cs2SeriesParticipant =
  | {
      state: "known";
      displayOrder: 1 | 2;
      team: Cs2TeamSummary;
      seriesScore: number;
    }
  | {
      state: "tbd";
      displayOrder: 1 | 2;
      seriesScore: null;
    };

export interface Cs2CompetitionSummary {
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface Cs2SeriesSummary {
  id: Uuid;
  arena: Cs2SeriesArenaForecast;
  participants: [Cs2SeriesParticipant, Cs2SeriesParticipant];
  competition: Cs2CompetitionSummary;
  format: number;
  scheduledStartTime: IsoDateTime;
  lifecycle: Cs2SeriesLifecycle;
}

export interface Cs2ArenaSummary {
  id: Uuid;
  activePlayersCount: number;
  entryFeeLamports: number;
  prizePoolLamports: number;
}

export interface Cs2TeamScore {
  teamId: Uuid;
  score: number;
}

export type Cs2SeriesMapSummary =
  | {
      state: "pending";
      seriesMatchIndex: number;
      mapName?: string;
    }
  | {
      state: ArenaStatus;
      seriesMatchIndex: number;
      mapName?: string;
      matchId: Uuid;
      matchStatus: Match["status"];
      cancelledReason?: ArenaCancelledReason;
      teams: [Cs2TeamScore, Cs2TeamScore];
      arena: Cs2ArenaSummary;
    };

export interface Cs2SeriesDetail extends Cs2SeriesSummary {
  maps: Cs2SeriesMapSummary[];
  /** Normalized Twitch, Kick, or YouTube stream URL set by the operator. */
  streamUrl?: string;
}

/** GET /series */
export interface Cs2SeriesListResponse {
  series: Cs2SeriesSummary[];
}

/** GET /series/follows?ids=... — which of the given series ids the authenticated user follows. */
export interface Cs2SeriesFollowsResponse {
  followedIds: Uuid[];
}

/** GET /series/:seriesId */
export interface Cs2SeriesDetailResponse {
  series: Cs2SeriesDetail;
}

export interface Cs2OperatorTeam {
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export type Cs2OperatorParticipantSlot =
  | { state: "known"; displayOrder: 1 | 2; team: Cs2OperatorTeam }
  | { state: "tbd"; displayOrder: 1 | 2 };

export type Cs2OperatorSeriesSelection =
  | { state: "selectable" }
  | {
      state: "disabled";
      reason: "PARTICIPANTS_INCOMPLETE" | "PARTICIPANTS_INVALID" | "FULL_LIVE_DATA_UNAVAILABLE";
    };

export interface Cs2OperatorDiscoverySeries {
  gridSeriesId: string;
  format: number;
  scheduledStartTime: IsoDateTime;
  competition: {
    gridTournamentId: string;
    name: string;
    shortName?: string;
    logoUrl?: string;
  };
  participants: [Cs2OperatorParticipantSlot, Cs2OperatorParticipantSlot];
  liveDataServiceLevel: "FULL" | "UNAVAILABLE";
  selection: Cs2OperatorSeriesSelection;
}

export interface Cs2OperatorDiscoveryPayload {
  window: { from: IsoDateTime; to: IsoDateTime };
  series: Cs2OperatorDiscoverySeries[];
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

/** POST /push/subscribe — save a browser's Web Push subscription. */
export interface PushSubscribeRequest {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushSubscribeResponse {
  subscribed: true;
}

/** POST /cs2/series/:id/follow — opt into arena-open push notifications for a series. */
export interface Cs2SeriesFollowResponse {
  followed: true;
}

/** DELETE /cs2/series/:id/follow — opt out of arena-open push notifications for a series. */
export interface Cs2SeriesUnfollowResponse {
  followed: false;
}

export interface PlayerLeaderboardEntry {
  userId: Uuid;
  username: string;
  avatar?: string;
  /** A disqualified player's rank is virtual: the place their points would take among the others. */
  rank: number;
  points: number;
  wins: number;
  arenasPlayed: number;
  disqualified: boolean;
  /** The prize place this board row holds; set only on `GET /leaderboard` rows. */
  prizePlace?: number;
}

export interface PlayerLeaderboardPrize {
  place: number;
  imageUrl: string;
}

/**
 * GET /leaderboard — the top players of the current scope, else of the scope closed last
 * (`finalized`: its final results); `scope: null` while there is neither.
 */
export type PlayerLeaderboardResponse =
  | { scope: null }
  | {
      scope: { name: string; finalized: boolean };
      competitions: Cs2CompetitionSummary[];
      /** Skin prizes by place, ordered by place. */
      prizes: PlayerLeaderboardPrize[];
      entries: PlayerLeaderboardEntry[];
      computedAt?: IsoDateTime;
    };

/** The signed-in winner's prize on the shown scope, once it was finalized with prizes. */
export interface PlayerLeaderboardPrizeClaim extends PlayerLeaderboardPrize {
  tradeUrl?: string;
  /** Once sent, the trade URL can no longer change. */
  sent: boolean;
}

/** GET /leaderboard/me — the signed-in player's row in the shown scope, if ranked. */
export interface PlayerLeaderboardMeResponse {
  entry: PlayerLeaderboardEntry | null;
  /** Shown only to the disqualified player. */
  disqualificationReason?: string;
  prize?: PlayerLeaderboardPrizeClaim;
}

/** A Steam trade offer link: `https://steamcommunity.com/tradeoffer/new/?partner=…&token=…`. */
export const STEAM_TRADE_URL_PATTERN = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d{1,20}&token=[A-Za-z0-9_-]{1,64}$/u;

/** POST /leaderboard/prize/trade-url — the winner sends or changes their trade URL until the prize is sent. */
export interface PlayerTradeUrlRequest {
  tradeUrl: string;
}

export interface PlayerTradeUrlResponse {
  prize: PlayerLeaderboardPrizeClaim;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
