import type {
  Arena,
  ArenaListResponse,
  BuyEntryResponse,
  MatchListResponse,
  WalletNonceRequest,
  WalletNonceResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { generateNonce, verifyWalletSignInRequest } from "@arena/auth";

// Until the backend is wired up, run against an in-process mock so the flow is
// demoable end-to-end. Set VITE_MOCK_API=false to hit the real API.
const USE_MOCK = (import.meta.env.VITE_MOCK_API ?? "true") !== "false";

// Session token from wallet sign-in; attached to authenticated calls.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
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
export async function fetchPrimaryArena(): Promise<Arena | null> {
  if (USE_MOCK) return null;
  const { matches } = await get<MatchListResponse>("/matches");
  const match = matches[0];
  if (!match) return null;
  const { arenas } = await get<ArenaListResponse>(`/arenas?matchId=${match.id}`);
  return arenas[0] ?? null;
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
