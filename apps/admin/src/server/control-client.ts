import { randomUUID } from "node:crypto";
import type {
  AdminCatalogResponse,
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
