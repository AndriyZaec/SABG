import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useWalletAuth, type WalletAuth } from "./useWalletAuth.js";

const AuthContext = createContext<WalletAuth | null>(null);

/** Single app-wide wallet-auth instance so every screen sees the same session/token. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useWalletAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): WalletAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
