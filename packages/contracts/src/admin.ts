import type { LeaderboardMarkAction, LeaderboardMarkStatus, LeaderboardScopeStatus, SeriesStatus } from "./enums.js";
import type { IsoDateTime, Uuid } from "./entities.js";
import type { Cs2SeriesSummary } from "./dto.js";

export type AdminAppHealth = "healthy" | "unhealthy" | "unknown";

export interface AdminControlStatus {
  generatedAt: IsoDateTime;
  revision: string;
  appHealth: AdminAppHealth;
  activeTournamentId?: string;
  autopilotEnabled: boolean;
  runningSeriesIds: string[];
  unfinishedArenaCount: number;
}

export interface AdminCatalogSeries extends Cs2SeriesSummary {
  gridSeriesId: string;
  status: SeriesStatus;
  priority: boolean;
  skipRequested: boolean;
  streamUrl?: string;
}

export interface AdminCatalogResponse {
  activeTournamentId?: string;
  series: AdminCatalogSeries[];
}

export type AdminMutationCommand =
  | { type: "autopilot.set"; enabled: boolean }
  | { type: "series.priority.set"; gridSeriesId: string; priority: boolean }
  | { type: "series.stream.set"; gridSeriesId: string; streamUrl: string | null }
  | { type: "series.skip.request"; gridSeriesId: string }
  | { type: "tournament.publish"; gridTournamentId: string; gridSeriesId: string }
  | { type: "leaderboard.scope.create"; name: string }
  | { type: "leaderboard.scope.rename"; scopeId: Uuid; name: string }
  /** Final recompute and close of the previous current scope, then this open one becomes current. */
  | { type: "leaderboard.scope.current.set"; scopeId: Uuid }
  /** Final recompute and close of the current scope, leaving none current. */
  | { type: "leaderboard.scope.close" }
  | { type: "leaderboard.competition.add"; scopeId: Uuid; competitionId: Uuid }
  | { type: "leaderboard.competition.remove"; scopeId: Uuid; competitionId: Uuid }
  /** Adds or replaces the prize for a place of an open scope. */
  | { type: "leaderboard.prize.set"; scopeId: Uuid; place: number; imageUrl: string }
  | { type: "leaderboard.prize.remove"; scopeId: Uuid; place: number }
  /** Stages a mark change for a player of the current scope; it reaches the board only on `leaderboard.marks.apply`. */
  | { type: "leaderboard.mark.draft.set"; scopeId: Uuid; userId: Uuid; action: LeaderboardMarkAction; reason?: string }
  | { type: "leaderboard.mark.draft.remove"; scopeId: Uuid; userId: Uuid }
  /** Applies every staged mark of the scope at once and queues a recompute. */
  | { type: "leaderboard.marks.apply"; scopeId: Uuid }
  /** Queues a worker recompute of the current scope; the result shows up once the worker runs. */
  | { type: "leaderboard.recompute" };

export type AdminMutationResult =
  | { status: "succeeded" }
  | { status: "requested" }
  | { status: "refused"; reason: string };

export type OperatorAuditResult = "succeeded" | "requested" | "refused" | "failed";

export type OperatorAuditValue = string | number | boolean | null;

export interface OperatorAuditDetails {
  before?: OperatorAuditValue;
  after?: OperatorAuditValue;
  reason?: string;
}

export interface OperatorAuditEntry {
  id: Uuid;
  createdAt: IsoDateTime;
  actorId: string;
  actorLogin: string;
  action: AdminMutationCommand["type"];
  targetId?: string;
  result: OperatorAuditResult;
  requestId: Uuid;
  details: OperatorAuditDetails;
}

export interface OperatorAuditPage {
  entries: OperatorAuditEntry[];
  nextCursor?: string;
}

export interface AdminLeaderboardScope {
  id: Uuid;
  name: string;
  status: LeaderboardScopeStatus;
  current: boolean;
  closedAt?: IsoDateTime;
  /** Competitions the scope counts. */
  competitionCount: number;
  /** Names of its competitions that still have an upcoming or live series. */
  unfinishedCompetitions: string[];
  /** Skin prizes by place, ordered by place. */
  prizes: AdminLeaderboardPrize[];
}

export interface AdminLeaderboardPrize {
  place: number;
  imageUrl: string;
}

export interface AdminLeaderboardCompetition {
  id: Uuid;
  name: string;
  shortName?: string;
  logoUrl?: string;
  /** Scopes that count this competition. */
  scopeIds: Uuid[];
  arenasWithResults: number;
  /** Has an upcoming or live series: its later arenas only count in a scope that holds it. */
  unfinished: boolean;
}

export interface AdminLeaderboardEntry {
  userId: Uuid;
  username: string;
  rank: number;
  points: number;
  wins: number;
  secondPlaces: number;
  roundsPlayed: number;
  arenasPlayed: number;
  totalPayoutLamports: number;
  /** Its rank is virtual: real players are ranked without it, and it never takes a prize place. */
  disqualified: boolean;
  /** The prize place this row holds by position among rows that are not disqualified. */
  prizePlace?: number;
}

export interface AdminLeaderboardMark {
  userId: Uuid;
  status: LeaderboardMarkStatus;
  /** Set only for `disqualified`. */
  reason?: string;
  appliedAt: IsoDateTime;
}

export interface AdminLeaderboardMarkDraft {
  userId: Uuid;
  action: LeaderboardMarkAction;
  /** Set only for `disqualify`. */
  reason?: string;
  actorLogin: string;
  updatedAt: IsoDateTime;
}

export interface AdminLeaderboardResponse {
  scopes: AdminLeaderboardScope[];
  competitions: AdminLeaderboardCompetition[];
  /** The current scope's top entries with its applied and staged marks; absent when no scope is current. */
  current?: {
    scopeId: Uuid;
    computedAt?: IsoDateTime;
    entries: AdminLeaderboardEntry[];
    marks: AdminLeaderboardMark[];
    drafts: AdminLeaderboardMarkDraft[];
  };
}
