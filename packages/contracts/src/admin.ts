import type { SeriesStatus } from "./enums.js";
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
  | { type: "tournament.publish"; gridTournamentId: string; gridSeriesId: string };

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
