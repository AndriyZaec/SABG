import type {
  Arena,
  ArenaDetailResponse,
  ArenaListResponse,
  Cs2Match,
  ArenaRoundsResponse,
  LeaderboardResponse,
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
  }
}

export interface PrimaryCs2Arena {
  arena: Arena;
  match: Cs2Match;
}

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

export async function fetchCs2ArenaRounds(arenaId: string): Promise<ArenaRoundsResponse> {
  return get<ArenaRoundsResponse>(`/arenas/${arenaId}/rounds`);
}

export async function prepareCs2Entry(arenaId: string, walletAddress: string): Promise<PrepareEntryResponse> {
  return post<PrepareEntryRequest, PrepareEntryResponse>(`/arenas/${arenaId}/entry/prepare`, { walletAddress });
}

export async function submitCs2Entry(arenaId: string, prepareId: string, signedTx: string): Promise<SubmitEntryResponse> {
  return post<SubmitEntryRequest, SubmitEntryResponse>(`/arenas/${arenaId}/entry/submit`, { prepareId, signedTx });
}
