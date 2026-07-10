import type {
  WalletNonceRequest,
  WalletNonceResponse,
  WalletSignInRequest,
  WalletSignInResponse,
} from "@arena/contracts";
import { generateNonce, verifyWalletSignInRequest } from "@arena/auth";

// Until the backend is wired up, run against an in-process mock so the flow is
// demoable end-to-end. Set VITE_MOCK_API=false to hit the real API.
const USE_MOCK = (import.meta.env.VITE_MOCK_API ?? "true") !== "false";

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
