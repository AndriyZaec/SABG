import type { LeaderboardScopeStatus, SeriesStatus } from "./enums.js";
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
  | { type: "leaderboard.competition.remove"; scopeId: Uuid; competitionId: Uuid };

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
}

export interface AdminLeaderboardResponse {
  scopes: AdminLeaderboardScope[];
  competitions: AdminLeaderboardCompetition[];
  /** The current scope's top entries; absent when no scope is current. */
  current?: { scopeId: Uuid; computedAt?: IsoDateTime; entries: AdminLeaderboardEntry[] };
}
