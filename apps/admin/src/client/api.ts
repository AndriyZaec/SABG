import type { AdminSessionResponse } from "../shared/session.js";

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
