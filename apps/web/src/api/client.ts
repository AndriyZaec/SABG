import type {
  Arena,
  ArenaDetailResponse,
  ArenaListResponse,
  BuyEntryResponse,
  LeaderboardResponse,
  Match,
  MatchListResponse,
  PrepareEntryResponse,
  RuntimeConfigResponse,
  SubmitEntryResponse,
  WalletNonceRequest,
  WalletNonceResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { generateNonce, verifyWalletSignInRequest } from "@arena/auth";

// Development remains standalone by default; production builds use the same-origin real backend.
const USE_MOCK = (import.meta.env.VITE_MOCK_API ?? (import.meta.env.PROD ? "false" : "true")) !== "false";

// Session token from wallet sign-in; attached to authenticated calls.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function getAuthToken(): string | null {
  return authToken;
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfigResponse> {
  return get<RuntimeConfigResponse>("/runtime-config");
}

async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return (await res.json()) as TRes;
}

async function post<TReq, TRes>(path: string, body: TReq, authed = false): Promise<TRes> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authed && authToken) headers["authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return (await res.json()) as TRes;
}

export async function requestNonce(
  req: WalletNonceRequest,
): Promise<WalletNonceResponse> {
  if (USE_MOCK) return { nonce: generateNonce() };
  return post<WalletNonceRequest, WalletNonceResponse>("/auth/nonce", req);
}

export async function walletSignIn(
  req: WalletSignInRequest,
): Promise<WalletSignInResponse> {
  if (USE_MOCK) {
    // Mirror what the backend will do: verify the signature, then issue a session.
    if (!verifyWalletSignInRequest(req)) throw new Error("Invalid signature");
    const short = `${req.walletAddress.slice(0, 4)}…${req.walletAddress.slice(-4)}`;
    return {
      token: `mock-${generateNonce(8)}`,
      user: {
        id: req.walletAddress,
        walletAddress: req.walletAddress,
        username: short,
      },
    };
  }
  return post<WalletSignInRequest, WalletSignInResponse>("/auth/wallet", req);
}

/**
 * The arena the frontend should target (demo has one match → one arena). Null in mock mode or
 * when the backend has no arena yet — callers then fall back to the standalone on-chain demo.
 */
/** The backend arena to target, paired with its match (teams, score, clock) for the lobby. */
export interface PrimaryArena {
  arena: Arena;
  match: Match;
}

export async function fetchPrimaryArena(): Promise<PrimaryArena | null> {
  if (USE_MOCK) return null;
  // Not every seeded match has an arena, and /matches order isn't arena order — scan for the match
  // that actually has one, preferring a joinable/running arena over a finished one.
  const { matches } = await get<MatchListResponse>("/matches");
  const found: PrimaryArena[] = [];
  for (const match of matches) {
    const { arenas } = await get<ArenaListResponse>(`/arenas?matchId=${match.id}`);
    for (const arena of arenas) found.push({ arena, match });
  }
  return found.find((p) => p.arena.status === "lobby" || p.arena.status === "live") ?? found[0] ?? null;
}

/** Full arena detail (match + current state + round) for the live arena. */
export async function fetchArenaDetail(arenaId: string): Promise<ArenaDetailResponse> {
  return get<ArenaDetailResponse>(`/arenas/${arenaId}`);
}

/** Current leaderboard snapshot — seeds the board on load (WS updates only fire on settle). */
export async function fetchLeaderboard(arenaId: string): Promise<LeaderboardResponse> {
  return get<LeaderboardResponse>(`/arenas/${arenaId}/leaderboard`);
}

/** Register an on-chain entry with the backend (joins the player to the arena game). */
export async function registerEntry(
  arenaId: string,
  txSignature: string,
): Promise<BuyEntryResponse> {
  return post<{ txSignature: string }, BuyEntryResponse>(
    `/arenas/${arenaId}/entry`,
    { txSignature },
    true,
  );
}

/** Backend-orchestrated entry, step 1: ask the backend to build the buy_entry tx to sign. */
export async function prepareEntry(arenaId: string, walletAddress: string): Promise<PrepareEntryResponse> {
  return post<{ walletAddress: string }, PrepareEntryResponse>(
    `/arenas/${arenaId}/entry/prepare`,
    { walletAddress },
  );
}

/** Step 2: hand back the signed tx; backend submits + seats + returns a session token. */
export async function submitEntry(
  arenaId: string,
  prepareId: string,
  signedTx: string,
): Promise<SubmitEntryResponse> {
  return post<{ prepareId: string; signedTx: string }, SubmitEntryResponse>(
    `/arenas/${arenaId}/entry/submit`,
    { prepareId, signedTx },
  );
}
