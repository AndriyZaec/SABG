import type { AdminCatalogResponse, AdminControlStatus, AdminMutationResult } from "@arena/contracts";
import type { AdminSessionResponse } from "../shared/session.js";

export interface MutationResponse {
  httpStatus: number;
  result: AdminMutationResult;
}

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function readSession(): Promise<AdminSessionResponse | undefined> {
  const response = await fetch("/api/session", { headers: { accept: "application/json" } });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new Error("Session service is unavailable");
  return response.json() as Promise<AdminSessionResponse>;
}

export async function logout(session: AdminSessionResponse): Promise<void> {
  const response = await fetch("/auth/logout", {
    method: "POST",
    headers: { "x-csrf-token": session.csrfToken },
  });
  if (!response.ok) throw new Error("Could not sign out");
}

export async function readControlStatus(): Promise<AdminControlStatus> {
  const response = await fetch("/api/control/status", { headers: { accept: "application/json" } });
  if (!response.ok) throw new AdminApiError("Runtime status is unavailable", response.status);
  return response.json() as Promise<AdminControlStatus>;
}

export async function readControlCatalog(): Promise<AdminCatalogResponse> {
  const response = await fetch("/api/control/catalog", { headers: { accept: "application/json" } });
  if (!response.ok) throw new AdminApiError("Series catalog is unavailable", response.status);
  return response.json() as Promise<AdminCatalogResponse>;
}

export async function setAutopilot(session: AdminSessionResponse, enabled: boolean): Promise<MutationResponse> {
  const response = await fetch("/api/control/mutations", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ type: "autopilot.set", enabled }),
  });
  if (!response.ok && response.status !== 409) throw new AdminApiError("Autopilot command failed", response.status);
  return {
    httpStatus: response.status,
    result: await response.json() as AdminMutationResult,
  };
}
