import type {
  ArenaDetailResponse,
  ArenaRoundsResponse,
  Cs2SeriesDetailResponse,
  Cs2SeriesFollowResponse,
  Cs2SeriesFollowsResponse,
  Cs2SeriesUnfollowResponse,
  Cs2SeriesListResponse,
  LeaderboardResponse,
  PrepareEntryRequest,
  PrepareEntryResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  SubmitEntryRequest,
  SubmitEntryResponse,
} from "@arena/contracts";
import { getAuthToken, notifyEventAccessRequired } from "../../api/client.js";

async function get<TRes>(path: string, authed = false): Promise<TRes> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (authed && token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`/cs2-api${path}`, { headers });
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

async function del<TRes>(path: string, authed = false): Promise<TRes> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (authed && token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`/cs2-api${path}`, { method: "DELETE", headers });
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

export async function fetchCs2Series(): Promise<Cs2SeriesListResponse> {
  return get<Cs2SeriesListResponse>("/series");
}

export async function fetchCs2SeriesFollows(seriesIds: string[]): Promise<Cs2SeriesFollowsResponse> {
  return get<Cs2SeriesFollowsResponse>(`/series/follows?ids=${seriesIds.join(",")}`, true);
}

export async function fetchCs2SeriesDetail(seriesId: string): Promise<Cs2SeriesDetailResponse> {
  return get<Cs2SeriesDetailResponse>(`/series/${seriesId}`);
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

export async function subscribeToPush(subscription: PushSubscribeRequest): Promise<PushSubscribeResponse> {
  return post<PushSubscribeRequest, PushSubscribeResponse>("/push/subscribe", subscription, true);
}

export async function followCs2Series(seriesId: string): Promise<Cs2SeriesFollowResponse> {
  return post<Record<string, never>, Cs2SeriesFollowResponse>(`/cs2/series/${seriesId}/follow`, {}, true);
}

export async function unfollowCs2Series(seriesId: string): Promise<Cs2SeriesUnfollowResponse> {
  return del<Cs2SeriesUnfollowResponse>(`/cs2/series/${seriesId}/follow`, true);
}
