import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { buildSignInMessage } from "@arena/auth";
import type { User } from "@arena/contracts";
import { requestNonce, walletSignIn, setAuthToken } from "../api/client.js";

type Status = "idle" | "signing" | "error";

export interface WalletAuth {
  connected: boolean;
  address: string | null;
  user: User | null;
  token: string | null;
  status: Status;
  error?: string;
  signIn: () => Promise<void>;
  signOut: () => void;
}

// Persist the session so a reload / navigation doesn't force another wallet signature.
const SESSION_KEY = "arena.session";
interface StoredSession {
  token: string;
  user: User;
  address: string;
}
function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}
function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — session just won't survive reloads */
  }
}
function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Connect-then-sign-in: fetch nonce → build message → wallet signs → verify server-side. */
export function useWalletAuth(): WalletAuth {
  const { publicKey, signMessage, connected } = useWallet();
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);
  const [token, setToken] = useState<string | null>(() => {
    const s = loadSession();
    if (s?.token) setAuthToken(s.token); // restore the API token before any authed call fires
    return s?.token ?? null;
  });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  // Wallet the current session belongs to — used to drop a restored session if the wallet changes.
  const sessionAddress = useRef<string | null>(loadSession()?.address ?? null);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    const address = publicKey.toBase58();
    setStatus("signing");
    setError(undefined);
    try {
      const { nonce } = await requestNonce({ walletAddress: address });
      const message = buildSignInMessage({
        domain: window.location.host,
        address,
        nonce,
      });
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(message)),
      );
      const res = await walletSignIn({ walletAddress: address, message, signature });
      setAuthToken(res.token);
      setUser(res.user);
      setToken(res.token);
      sessionAddress.current = address;
      saveSession({ token: res.token, user: res.user, address });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Sign-in failed");
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setToken(null);
    setStatus("idle");
    setError(undefined);
    sessionAddress.current = null;
    clearSession();
  }, []);

  // Auto sign-in on connect (once per address, no retry after rejection). A restored session for a
  // different wallet is dropped first so we re-sign for the wallet that's actually connected.
  const autoSignedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !publicKey) {
      autoSignedFor.current = null;
      return;
    }
    const address = publicKey.toBase58();
    if (user && sessionAddress.current && sessionAddress.current !== address) {
      signOut();
      return;
    }
    if (!user && status === "idle" && autoSignedFor.current !== address) {
      autoSignedFor.current = address;
      void signIn();
    }
  }, [connected, publicKey, user, status, signIn, signOut]);

  return {
    connected,
    address: publicKey?.toBase58() ?? null,
    user,
    token,
    status,
    error,
    signIn,
    signOut,
  };
}
