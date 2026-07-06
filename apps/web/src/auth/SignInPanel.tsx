import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWalletAuth } from "./useWalletAuth.js";

/** Wallet connect + sign-in control. */
export function SignInPanel() {
  const { connected, user, status, error, signIn, signOut } = useWalletAuth();

  return (
    <section style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <WalletMultiButton />

      {connected && !user && (
        <button onClick={signIn} disabled={status === "signing"}>
          {status === "signing" ? "Signing…" : "Sign in"}
        </button>
      )}

      {user && (
        <>
          <span>Signed in as {user.username}</span>
          <button onClick={signOut}>Sign out</button>
        </>
      )}

      {error && (
        <span role="alert" style={{ color: "crimson" }}>
          {error}
        </span>
      )}
    </section>
  );
}
