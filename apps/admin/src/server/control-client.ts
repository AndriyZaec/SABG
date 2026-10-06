import { randomUUID } from "node:crypto";
import type {
  AdminCatalogResponse,
  AdminCatalogSeries,
  AdminControlStatus,
  AdminMutationCommand,
  AdminMutationResult,
  Cs2OperatorDiscoveryPayload,
  OperatorAuditPage,
} from "@arena/contracts";

export interface ControlResponse<T> {
  status: number;
  body: T;
  requestId?: string;
}

export interface ControlActor {
  id: string;
  login: string;
}

export interface AuditFilters {
  actorId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface AdminControlClient {
  status(): Promise<ControlResponse<AdminControlStatus>>;
  catalog(): Promise<ControlResponse<AdminCatalogResponse>>;
  discovery(): Promise<ControlResponse<Cs2OperatorDiscoveryPayload>>;
  inspect(gridSeriesId: string): Promise<ControlResponse<Cs2OperatorDiscoveryPayload>>;
  audit(filters: AuditFilters): Promise<ControlResponse<OperatorAuditPage>>;
  mutate(command: AdminMutationCommand, actor: ControlActor): Promise<ControlResponse<AdminMutationResult>>;
}

async function responseBody<T>(response: Response): Promise<ControlResponse<T>> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  return {
    status: response.status,
    body: await response.json() as T,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

export function createLiveControlClient(options: {
  baseUrl: string;
  machineToken: string;
  fetch?: typeof globalThis.fetch;
}): AdminControlClient {
  const request = options.fetch ?? globalThis.fetch;
  const send = async <T>(path: string, init?: RequestInit): Promise<ControlResponse<T>> => responseBody<T>(await request(
    `${options.baseUrl}${path}`,
    {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...init?.headers,
        authorization: `Bearer ${options.machineToken}`,
      },
    },
  ));

  return {
    status: () => send("/status"),
    catalog: () => send("/catalog"),
    discovery: () => send("/discovery"),
    inspect: (gridSeriesId) => send(`/series/${encodeURIComponent(gridSeriesId)}`),
    audit: (filters) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) query.set(key, value);
      }
      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      return send(`/audit${suffix}`);
    },
    mutate: (command, actor) => send("/mutations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-operator-id": actor.id,
        "x-operator-login": actor.login,
        "x-request-id": randomUUID(),
      },
      body: JSON.stringify(command),
    }),
  };
}

export function createFixtureControlClient(): AdminControlClient {
  let autopilotEnabled = true;
  let activeTournamentId = "fixture-tournament";
  let priority = true;
  let skipRequested = false;
  let streamUrl: string | undefined;
  const now = () => new Date().toISOString();
  const fixtureSeries = (): AdminCatalogSeries => ({
    id: "00000000-0000-4000-8000-000000000001",
    gridSeriesId: "2985953",
    arena: "running",
    participants: [
      {
        state: "known",
        displayOrder: 1,
        team: { id: "00000000-0000-4000-8000-000000000002", name: "Inner Circle" },
        seriesScore: 1,
      },
      {
        state: "known",
        displayOrder: 2,
        team: { id: "00000000-0000-4000-8000-000000000003", name: "ENCE" },
        seriesScore: 0,
      },
    ],
    competition: { name: "European Pro League", shortName: "EPL" },
    format: 3,
    scheduledStartTime: "2026-10-06T17:00:00.000Z",
    lifecycle: "live",
    status: "active",
    priority,
    skipRequested,
    ...(streamUrl !== undefined ? { streamUrl } : {}),
  });
  return {
    status: async () => ({
      status: 200,
      body: {
        generatedAt: now(),
        revision: "fixture",
        appHealth: "healthy",
        activeTournamentId,
        autopilotEnabled,
        runningSeriesIds: skipRequested ? [] : ["2985953"],
        unfinishedArenaCount: skipRequested ? 0 : 1,
      },
    }),
    catalog: async () => ({
      status: 200,
      body: {
        activeTournamentId,
        series: [fixtureSeries()],
      },
    }),
    discovery: async () => ({
      status: 200,
      body: {
        window: { from: now(), to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString() },
        series: [
          {
            gridSeriesId: "3100451",
            format: 3,
            scheduledStartTime: "2026-10-07T19:00:00.000Z",
            competition: { gridTournamentId: "epl-season-7", name: "European Pro League Season 7", shortName: "EPL S7" },
            participants: [
              { state: "known", displayOrder: 1, team: { gridTeamId: "team-vitality", name: "Vitality" } },
              { state: "known", displayOrder: 2, team: { gridTeamId: "team-spirit", name: "Spirit" } },
            ],
            liveDataServiceLevel: "FULL",
            selection: { state: "selectable" },
          },
          {
            gridSeriesId: "3100452",
            format: 3,
            scheduledStartTime: "2026-10-08T16:00:00.000Z",
            competition: { gridTournamentId: "epl-season-7", name: "European Pro League Season 7", shortName: "EPL S7" },
            participants: [
              { state: "known", displayOrder: 1, team: { gridTeamId: "team-navi", name: "NAVI" } },
              { state: "known", displayOrder: 2, team: { gridTeamId: "team-g2", name: "G2" } },
            ],
            liveDataServiceLevel: "UNAVAILABLE",
            selection: { state: "disabled", reason: "FULL_LIVE_DATA_UNAVAILABLE" },
          },
        ],
      },
    }),
    inspect: async (gridSeriesId) => ({
      status: 200,
      body: {
        window: { from: now(), to: now() },
        series: [{
          gridSeriesId,
          format: 3,
          scheduledStartTime: "2026-10-07T19:00:00.000Z",
          competition: { gridTournamentId: activeTournamentId, name: "European Pro League", shortName: "EPL" },
          participants: [
            { state: "known", displayOrder: 1, team: { gridTeamId: "team-vitality", name: "Vitality" } },
            { state: "known", displayOrder: 2, team: { gridTeamId: "team-spirit", name: "Spirit" } },
          ],
          liveDataServiceLevel: "FULL",
          selection: { state: "selectable" },
        }],
      },
    }),
    audit: async () => ({ status: 200, body: { entries: [] } }),
    mutate: async (command) => {
      if (command.type === "autopilot.set") autopilotEnabled = command.enabled;
      if (command.type === "series.priority.set") priority = command.priority;
      if (command.type === "series.stream.set") streamUrl = command.streamUrl ?? undefined;
      if (command.type === "series.skip.request") skipRequested = true;
      if (command.type === "tournament.publish") activeTournamentId = command.gridTournamentId;
      return {
        status: 200,
        body: { status: command.type === "series.skip.request" ? "requested" : "succeeded" },
        requestId: randomUUID(),
      };
    },
  };
}
