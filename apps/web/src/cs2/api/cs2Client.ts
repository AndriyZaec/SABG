// CS2's REST client — a parallel, minimal clone of api/client.ts's relevant subset, pointed at
// the CS2 gateway's own base path (`/cs2-api`, proxied to CS2_GATEWAY_PORT — see vite.config.ts)
// instead of soccer's `/api`. Deliberately not imported from api/client.ts: sharing the base
// path constant there would be the one soccer file this tree touches, and the "get"/"post"
// helpers are trivial enough that a parallel copy is cheaper than threading a base-path parameter
// through the shared one.

import type {
  Arena,
  ArenaDetailResponse,
  ArenaListResponse,
  ArenaRoundsResponse,
  LeaderboardResponse,
  Match,
  MatchListResponse,
  PrepareEntryRequest,
  PrepareEntryResponse,
  SubmitEntryRequest,
  SubmitEntryResponse,
} from "@arena/contracts";
import { getAuthToken, notifyEventAccessRequired } from "../../api/client.js";

async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(`/cs2-api${path}`);
  await reportEventAccessFailure(res);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return (await res.json()) as TRes;
}

// Auth token is api/client.ts's module-level state, not duplicated here — the CS2 and soccer
// gateways share AUTH_SECRET (5b2), so a token minted by either sign-in flow is valid on both.
async function post<TReq, TRes>(path: string, body: TReq, authed = false): Promise<TRes> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getAuthToken();
  if (authed && token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`/cs2-api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  await reportEventAccessFailure(res);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return (await res.json()) as TRes;
}

async function reportEventAccessFailure(response: Response): Promise<void> {
  if (response.status !== 401) return;
  try {
    const body = (await response.clone().json()) as { error?: string };
    if (body.error === "event_access_required") notifyEventAccessRequired();
  } catch {
    // A non-JSON 401 belongs to another authentication boundary.
  }
}

export interface PrimaryCs2Arena {
  arena: Arena;
  match: Match;
}

/**
 * The CS2 arena the frontend should target, if any. `GET /matches` on the CS2 gateway hits the
 * same Postgres soccer uses and returns rows from both disciplines (no server-side filter) — the
 * `match.discipline === "cs2"` check here is the client-side guard against picking up a soccer
 * match by accident.
 */
export async function fetchPrimaryCs2Arena(): Promise<PrimaryCs2Arena | null> {
  const { matches } = await get<MatchListResponse>("/matches");
  const found: PrimaryCs2Arena[] = [];
  for (const match of matches) {
    if (match.discipline !== "cs2") continue;
    const { arenas } = await get<ArenaListResponse>(`/arenas?matchId=${match.id}`);
    for (const arena of arenas) found.push({ arena, match });
  }
  return found.find((p) => p.arena.status === "lobby" || p.arena.status === "live") ?? found[0] ?? null;
}

export async function fetchCs2ArenaDetail(arenaId: string): Promise<ArenaDetailResponse> {
  return get<ArenaDetailResponse>(`/arenas/${arenaId}`);
}

export async function fetchCs2Leaderboard(arenaId: string): Promise<LeaderboardResponse> {
  return get<LeaderboardResponse>(`/arenas/${arenaId}/leaderboard`);
}

/** Full round history — used to reconstruct the match feed on load (see api/client.ts's
 *  fetchArenaRounds; `feed` itself is purely client-side and doesn't survive a reload). */
export async function fetchCs2ArenaRounds(arenaId: string): Promise<ArenaRoundsResponse> {
  return get<ArenaRoundsResponse>(`/arenas/${arenaId}/rounds`);
}

/**
 * Backend-orchestrated entry, step 1: ask the CS2 gateway to build the buy_entry tx to sign.
 * Same on-chain path soccer uses (gateway/rest.ts's /entry/prepare is fully discipline-agnostic
 * — confirmed in step 5b2's research, no CS2-specific backend change was needed).
 */
export async function prepareCs2Entry(arenaId: string, walletAddress: string): Promise<PrepareEntryResponse> {
  return post<PrepareEntryRequest, PrepareEntryResponse>(`/arenas/${arenaId}/entry/prepare`, { walletAddress });
}

/** Step 2: hand back the signed tx; the CS2 gateway submits + seats + returns a session token. */
export async function submitCs2Entry(arenaId: string, prepareId: string, signedTx: string): Promise<SubmitEntryResponse> {
  return post<SubmitEntryRequest, SubmitEntryResponse>(`/arenas/${arenaId}/entry/submit`, { prepareId, signedTx });
}
