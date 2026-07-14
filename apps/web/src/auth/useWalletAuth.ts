import { useCallback, useState } from "react";
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

/** Connect-then-sign-in: fetch nonce → build message → wallet signs → verify server-side. */
export function useWalletAuth(): WalletAuth {
  const { publicKey, signMessage, connected } = useWallet();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();

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
  }, []);

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
