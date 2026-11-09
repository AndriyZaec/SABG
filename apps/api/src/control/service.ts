import type {
  AdminCatalogResponse,
  AdminControlStatus,
  AdminLeaderboardResponse,
  AdminMutationCommand,
  AdminMutationResult,
  Cs2OperatorDiscoveryPayload,
  OperatorAuditDetails,
  OperatorAuditPage,
  Uuid,
} from "@arena/contracts";
import { normalizeCs2StreamUrl } from "@arena/contracts";
import { activateCs2Series } from "../cs2/operator-activate.js";
import { buildOperatorDiscoveryPayload, operatorDiscoveryWindow } from "../cs2/operator-discovery.js";
import { GridCentralDataClient } from "../cs2/central-data-client.js";
import { tryAcquireOperatorMutationLock, type ReleaseDatabaseLock } from "../db/client.js";
import { cs2CatalogRepository } from "../db/repositories/cs2-catalog.repository.js";
import { operatorAuditRepository, type AppendOperatorAudit } from "../db/repositories/operator-audit.repository.js";
import { leaderboardRepository } from "../db/repositories/leaderboard.repository.js";
import { operatorControlRepository } from "../db/repositories/operator-control.repository.js";
import { recomputeScope } from "../leaderboard/recompute.js";
import {
  CS2_AUTOPILOT_SETTING,
  settingsRepository,
} from "../db/repositories/settings.repository.js";

export interface OperatorIdentity {
  id: string;
  login: string;
}

export interface OperatorMutationExecution {
  result: AdminMutationResult;
  conflict?: boolean;
}

const ADMIN_LEADERBOARD_TOP = 100;
// Another operator switched or closed the current scope between this request's read and its write.
const CURRENT_SCOPE_CHANGED = "Current scope changed; reload and try again";

export type LeaderboardControl = Pick<
  typeof leaderboardRepository,
  | "listScopes"
  | "findScope"
  | "findCurrent"
  | "createScope"
  | "renameScope"
  | "setCurrent"
  | "closeCurrent"
  | "addCompetition"
  | "removeCompetition"
  | "competitionExists"
  | "listAdminCompetitions"
  | "listScopeCompetitionSummaries"
  | "topEntries"
> & { recomputeScope: typeof recomputeScope };

export interface OperatorControlDependencies {
  getActiveTournamentId(): Promise<string | undefined>;
  setActiveTournamentId(gridTournamentId: string): Promise<void>;
  isAutopilotEnabled(): Promise<boolean>;
  setAutopilotEnabled(enabled: boolean): Promise<void>;
  readRuntimeState(): Promise<{ runningSeriesIds: string[]; unfinishedArenaCount: number }>;
  hasRunner(): boolean;
  runWhileIdle<T>(task: () => Promise<T>): Promise<{ kind: "busy" } | { kind: "completed"; value: T }>;
  listCatalog(runningSeriesId?: Uuid): ReturnType<typeof cs2CatalogRepository.listAdmin>;
  getRunningSeriesId(): Uuid | undefined;
  findSeries: typeof operatorControlRepository.findSeries;
  setSeriesPriority: typeof operatorControlRepository.setSeriesPriority;
  setSeriesStream: typeof operatorControlRepository.setSeriesStream;
  requestSeriesSkip: typeof operatorControlRepository.requestSeriesSkip;
  hasPaidEntry: typeof operatorControlRepository.hasPaidEntry;
  acquirePublishLock(): Promise<ReleaseDatabaseLock | undefined>;
  appendAudit(input: AppendOperatorAudit): Promise<unknown>;
  listAudits: typeof operatorAuditRepository.list;
  discover(): Promise<Cs2OperatorDiscoveryPayload>;
  inspect(gridSeriesId: string): Promise<Cs2OperatorDiscoveryPayload>;
  activate(gridSeriesId: string, expectedTournamentId: string): ReturnType<typeof activateCs2Series>;
  leaderboard: LeaderboardControl;
  /** False while the recompute queue isn't running yet. */
  queueLeaderboardRecompute(): boolean;
}

export interface OperatorAuditQuery {
  actorId?: string;
  from?: Date;
  to?: Date;
  cursor?: { createdAt: Date; id: string };
}

const targetIdFor = (command: AdminMutationCommand): string | undefined => {
  switch (command.type) {
    case "autopilot.set":
      return CS2_AUTOPILOT_SETTING;
    case "tournament.publish":
      return command.gridTournamentId;
    case "series.priority.set":
    case "series.stream.set":
    case "series.skip.request":
      return command.gridSeriesId;
    case "leaderboard.scope.create":
    case "leaderboard.scope.close":
    case "leaderboard.recompute":
      return undefined;
    case "leaderboard.scope.rename":
    case "leaderboard.scope.current.set":
    case "leaderboard.competition.add":
    case "leaderboard.competition.remove":
      return command.scopeId;
  }
};

function createDefaultDependencies(
  getRunningSeriesId: () => Uuid | undefined,
  hasRunner: () => boolean,
  runWhileIdle: OperatorControlDependencies["runWhileIdle"],
  now: () => Date,
  queueLeaderboardRecompute: () => boolean,
): OperatorControlDependencies {
  const gridClient = new GridCentralDataClient();
  return {
    getActiveTournamentId: () => settingsRepository.getActiveCs2TournamentId(),
    setActiveTournamentId: (id) => settingsRepository.setActiveCs2TournamentId(id),
    isAutopilotEnabled: () => settingsRepository.isEnabled(CS2_AUTOPILOT_SETTING),
    setAutopilotEnabled: (enabled) => settingsRepository.setEnabled(CS2_AUTOPILOT_SETTING, enabled),
    readRuntimeState: () => operatorControlRepository.readRuntimeState(),
    hasRunner,
    runWhileIdle,
    listCatalog: (runningSeriesId) => cs2CatalogRepository.listAdmin({ runningSeriesId }),
    getRunningSeriesId,
    findSeries: (id) => operatorControlRepository.findSeries(id),
    setSeriesPriority: (id, priority) => operatorControlRepository.setSeriesPriority(id, priority),
    setSeriesStream: (id, streamUrl) => operatorControlRepository.setSeriesStream(id, streamUrl),
    requestSeriesSkip: (id) => operatorControlRepository.requestSeriesSkip(id),
    hasPaidEntry: (id) => operatorControlRepository.hasPaidEntry(id),
    acquirePublishLock: tryAcquireOperatorMutationLock,
    appendAudit: (input) => operatorAuditRepository.append(input),
    listAudits: (input) => operatorAuditRepository.list(input),
    discover: async () => {
      const current = now();
      const configuredWindow = operatorDiscoveryWindow(current);
      const window = { from: current, to: configuredWindow.to };
      return buildOperatorDiscoveryPayload(window, await gridClient.discoverSeriesPage(window));
    },
    inspect: async (gridSeriesId) => {
      const window = operatorDiscoveryWindow(now());
      const found = await gridClient.fetchSeriesById(gridSeriesId);
      return buildOperatorDiscoveryPayload(window, found === undefined ? [] : [found]);
    },
    activate: (gridSeriesId, expectedTournamentId) => activateCs2Series(gridSeriesId, { expectedTournamentId }),
    leaderboard: { ...leaderboardRepository, recomputeScope },
    queueLeaderboardRecompute,
  };
}

export class OperatorControlService {
  private discoveryCache: { expiresAt: number; payload: Cs2OperatorDiscoveryPayload } | undefined;
  private discoveryRequest: Promise<Cs2OperatorDiscoveryPayload> | undefined;

  constructor(
    private readonly deps: OperatorControlDependencies,
    private readonly revision: string,
    private readonly now: () => Date = () => new Date(),
    private readonly discoveryTtlMs = 60_000,
  ) {}

  async status(): Promise<AdminControlStatus> {
    const [activeTournamentId, autopilotEnabled, runtime] = await Promise.all([
      this.deps.getActiveTournamentId(),
      this.deps.isAutopilotEnabled(),
      this.deps.readRuntimeState(),
    ]);
    return {
      generatedAt: this.now().toISOString(),
      revision: this.revision,
      appHealth: "healthy",
      ...(activeTournamentId !== undefined ? { activeTournamentId } : {}),
      autopilotEnabled,
      ...runtime,
    };
  }

  async catalog(): Promise<AdminCatalogResponse> {
    const [activeTournamentId, series] = await Promise.all([
      this.deps.getActiveTournamentId(),
      this.deps.listCatalog(this.deps.getRunningSeriesId()),
    ]);
    return { ...(activeTournamentId !== undefined ? { activeTournamentId } : {}), series };
  }

  async leaderboard(query?: string): Promise<AdminLeaderboardResponse> {
    const { leaderboard } = this.deps;
    const [scopes, competitions, summaries] = await Promise.all([
      leaderboard.listScopes(),
      leaderboard.listAdminCompetitions(query),
      leaderboard.listScopeCompetitionSummaries(),
    ]);
    const current = scopes.find((scope) => scope.isCurrent);
    const entries = current === undefined ? [] : await leaderboard.topEntries(current.id, ADMIN_LEADERBOARD_TOP);
    const computedAt = entries[0]?.computedAt;
    return {
      scopes: scopes.map((scope) => {
        const summary = summaries.find((row) => row.scopeId === scope.id);
        return {
          id: scope.id,
          name: scope.name,
          status: scope.status,
          current: scope.isCurrent,
          ...(scope.closedAt !== null ? { closedAt: scope.closedAt.toISOString() } : {}),
          competitionCount: summary?.competitionCount ?? 0,
          unfinishedCompetitions: summary?.unfinishedCompetitions ?? [],
        };
      }),
      competitions: competitions.map(({ shortName, logoUrl, ...competition }) => ({
        ...competition,
        ...(shortName !== null ? { shortName } : {}),
        ...(logoUrl !== null ? { logoUrl } : {}),
      })),
      ...(current !== undefined
        ? {
            current: {
              scopeId: current.id,
              ...(computedAt !== undefined ? { computedAt: computedAt.toISOString() } : {}),
              entries: entries.map((entry) => ({
                userId: entry.userId,
                username: entry.username,
                rank: entry.rank,
                points: entry.points,
                wins: entry.wins,
                secondPlaces: entry.secondPlaces,
                roundsPlayed: entry.roundsPlayed,
                arenasPlayed: entry.arenasPlayed,
                totalPayoutLamports: entry.totalPayoutLamports,
              })),
            },
          }
        : {}),
    };
  }

  async discover(): Promise<Cs2OperatorDiscoveryPayload> {
    const cached = this.discoveryCache;
    if (cached !== undefined && cached.expiresAt > this.now().getTime()) return cached.payload;
    if (this.discoveryRequest !== undefined) return this.discoveryRequest;
    this.discoveryRequest = this.deps.discover().then((payload) => {
      this.discoveryCache = { expiresAt: this.now().getTime() + this.discoveryTtlMs, payload };
      return payload;
    }).finally(() => {
      this.discoveryRequest = undefined;
    });
    return this.discoveryRequest;
  }

  inspect(gridSeriesId: string): Promise<Cs2OperatorDiscoveryPayload> {
    return this.deps.inspect(gridSeriesId);
  }

  async audits(query: OperatorAuditQuery): Promise<OperatorAuditPage> {
    const entries = await this.deps.listAudits({ ...query, limit: 50 });
    const last = entries.at(-1);
    return {
      entries,
      ...(entries.length === 50 && last !== undefined
        ? { nextCursor: Buffer.from(JSON.stringify([last.createdAt, last.id]), "utf8").toString("base64url") }
        : {}),
    };
  }

  async mutate(
    command: AdminMutationCommand,
    actor: OperatorIdentity,
    requestId: string,
  ): Promise<OperatorMutationExecution> {
    let release: ReleaseDatabaseLock | undefined;
    if (command.type === "tournament.publish") {
      release = await this.deps.acquirePublishLock();
      if (release === undefined) {
        const result = { status: "refused", reason: "Another tournament publication is running" } as const;
        await this.audit(command, actor, requestId, result.status, { reason: result.reason });
        return { result, conflict: true };
      }
    }

    try {
      let execution: { result: AdminMutationResult; details?: OperatorAuditDetails };
      try {
        execution = await this.execute(command);
      } catch (error) {
        await this.audit(command, actor, requestId, "failed", { reason: "Command failed" });
        throw error;
      }
      await this.audit(command, actor, requestId, execution.result.status, execution.details);
      return { result: execution.result };
    } finally {
      await release?.();
    }
  }

  private async execute(command: AdminMutationCommand): Promise<{
    result: AdminMutationResult;
    details?: OperatorAuditDetails;
  }> {
    switch (command.type) {
      case "autopilot.set": {
        const before = await this.deps.isAutopilotEnabled();
        await this.deps.setAutopilotEnabled(command.enabled);
        return { result: { status: "succeeded" }, details: { before, after: command.enabled } };
      }
      case "series.priority.set": {
        const current = await this.deps.findSeries(command.gridSeriesId);
        if (current?.status !== "active") return this.refused("Series is not active");
        await this.deps.setSeriesPriority(command.gridSeriesId, command.priority);
        return { result: { status: "succeeded" }, details: { before: current.priority, after: command.priority } };
      }
      case "series.stream.set": {
        const current = await this.deps.findSeries(command.gridSeriesId);
        if (current?.status !== "active") return this.refused("Series is not active");
        let streamUrl: string | null = null;
        if (command.streamUrl !== null) {
          try {
            streamUrl = normalizeCs2StreamUrl(command.streamUrl).url;
          } catch (error) {
            return this.refused(error instanceof Error ? error.message : "Stream URL is invalid");
          }
        }
        await this.deps.setSeriesStream(command.gridSeriesId, streamUrl);
        return { result: { status: "succeeded" }, details: { before: current.streamUrl, after: streamUrl } };
      }
      case "series.skip.request": {
        const current = await this.deps.findSeries(command.gridSeriesId);
        if (current?.status !== "active") return this.refused("Series is not active");
        if (await this.deps.hasPaidEntry(command.gridSeriesId)) {
          return this.refused("Series has paid entries");
        }
        if (!await this.deps.requestSeriesSkip(command.gridSeriesId)) {
          return this.refused(await this.deps.hasPaidEntry(command.gridSeriesId)
            ? "Series has paid entries"
            : "Series is not active");
        }
        return { result: { status: "requested" }, details: { before: current.skipRequested, after: true } };
      }
      case "tournament.publish": {
        const publication = await this.deps.runWhileIdle(async () => {
          const beforeSync = await this.publicationBlocker();
          if (beforeSync !== undefined) return this.refused(beforeSync);
          const before = await this.deps.getActiveTournamentId() ?? null;
          await this.deps.activate(command.gridSeriesId, command.gridTournamentId);
          const afterSync = await this.publicationBlocker();
          if (afterSync !== undefined) return this.refused(afterSync);
          await this.deps.setActiveTournamentId(command.gridTournamentId);
          return { result: { status: "succeeded" } as const, details: { before, after: command.gridTournamentId } };
        });
        return publication.kind === "busy"
          ? this.refused("A CS2 Series is running; Skip it or wait for it to finish")
          : publication.value;
      }
      case "leaderboard.scope.create": {
        await this.deps.leaderboard.createScope(command.name);
        return { result: { status: "succeeded" }, details: { after: command.name } };
      }
      case "leaderboard.scope.rename": {
        const scope = await this.deps.leaderboard.findScope(command.scopeId);
        if (scope === undefined) return this.refused("Scope not found");
        await this.deps.leaderboard.renameScope(command.scopeId, command.name);
        return { result: { status: "succeeded" }, details: { before: scope.name, after: command.name } };
      }
      case "leaderboard.scope.current.set": {
        const scope = await this.deps.leaderboard.findScope(command.scopeId);
        if (scope === undefined) return this.refused("Scope not found");
        if (scope.status !== "open") return this.refused("Scope is closed");
        const previous = await this.deps.leaderboard.findCurrent();
        // The previous scope's final result, before it closes and stops being recomputed.
        if (previous !== undefined && previous.id !== scope.id) await this.deps.leaderboard.recomputeScope(previous.id);
        const switched = await this.deps.leaderboard.setCurrent(scope.id, previous?.id ?? null);
        if (switched === "closed") return this.refused("Scope is closed");
        if (switched === "current_changed") return this.refused(CURRENT_SCOPE_CHANGED);
        return { result: { status: "succeeded" }, details: { before: previous?.id ?? null, after: scope.id } };
      }
      case "leaderboard.scope.close": {
        const current = await this.deps.leaderboard.findCurrent();
        if (current === undefined) return this.refused("No current scope");
        await this.deps.leaderboard.recomputeScope(current.id);
        if (!await this.deps.leaderboard.closeCurrent(current.id)) return this.refused(CURRENT_SCOPE_CHANGED);
        return { result: { status: "succeeded" }, details: { before: current.id, after: null } };
      }
      case "leaderboard.recompute": {
        const current = await this.deps.leaderboard.findCurrent();
        if (current === undefined) return this.refused("No current scope");
        if (!this.deps.queueLeaderboardRecompute()) return this.refused("Recompute queue is not running");
        return { result: { status: "requested" }, details: { after: current.id } };
      }
      case "leaderboard.competition.add":
      case "leaderboard.competition.remove": {
        const scope = await this.deps.leaderboard.findScope(command.scopeId);
        if (scope === undefined) return this.refused("Scope not found");
        if (scope.status !== "open") return this.refused("Scope is closed");
        if (!await this.deps.leaderboard.competitionExists(command.competitionId)) return this.refused("Competition not found");
        const adding = command.type === "leaderboard.competition.add";
        const changed = adding
          ? await this.deps.leaderboard.addCompetition(command.scopeId, command.competitionId)
          : await this.deps.leaderboard.removeCompetition(command.scopeId, command.competitionId);
        if (!changed) return this.refused("Scope is closed");
        return {
          result: { status: "succeeded" },
          details: adding ? { after: command.competitionId } : { before: command.competitionId, after: null },
        };
      }
    }
  }

  private refused(reason: string): { result: AdminMutationResult; details: OperatorAuditDetails } {
    return { result: { status: "refused", reason }, details: { reason } };
  }

  private async publicationBlocker(): Promise<string | undefined> {
    if (this.deps.hasRunner()) return "A CS2 Series is running; Skip it or wait for it to finish";
    const runtime = await this.deps.readRuntimeState();
    if (runtime.runningSeriesIds.length > 0) return "A CS2 Series is running; Skip it or wait for it to finish";
    if (runtime.unfinishedArenaCount > 0) return "An unfinished CS2 Arena exists; Skip it or wait for it to finish";
    return undefined;
  }

  private audit(
    command: AdminMutationCommand,
    actor: OperatorIdentity,
    requestId: string,
    result: AppendOperatorAudit["result"],
    details?: OperatorAuditDetails,
  ): Promise<unknown> {
    const targetId = targetIdFor(command);
    return this.deps.appendAudit({
      actorId: actor.id,
      actorLogin: actor.login,
      action: command.type,
      ...(targetId !== undefined ? { targetId } : {}),
      result,
      requestId,
      ...(details !== undefined ? { details } : {}),
    });
  }
}

export function createOperatorControlService(options: {
  revision?: string;
  getRunningSeriesId?: () => Uuid | undefined;
  hasRunner?: () => boolean;
  runWhileIdle?: OperatorControlDependencies["runWhileIdle"];
  queueLeaderboardRecompute?: () => boolean;
  now?: () => Date;
  dependencies?: OperatorControlDependencies;
} = {}): OperatorControlService {
  const now = options.now ?? (() => new Date());
  const getRunningSeriesId = options.getRunningSeriesId ?? (() => undefined);
  const hasRunner = options.hasRunner ?? (() => false);
  const runWhileIdle = options.runWhileIdle ?? (async (task) => ({ kind: "completed" as const, value: await task() }));
  const queueLeaderboardRecompute = options.queueLeaderboardRecompute ?? (() => false);
  return new OperatorControlService(
    options.dependencies ?? createDefaultDependencies(getRunningSeriesId, hasRunner, runWhileIdle, now, queueLeaderboardRecompute),
    options.revision ?? process.env["SABG_VCS_REF"] ?? "unknown",
    now,
  );
}
