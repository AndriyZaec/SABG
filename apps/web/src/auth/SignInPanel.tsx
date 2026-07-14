import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWalletAuth } from "./useWalletAuth.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";

/** Wallet connect + sign-in control (lives in the masthead). */
export function SignInPanel() {
  const { connected, user, status, error, signIn, signOut } = useWalletAuth();

  return (
    <div className="nb-row" style={{ gap: 10 }}>
      <WalletMultiButton />

      {connected && !user && (
        <Button variant="primary" onClick={signIn} disabled={status === "signing"}>
          {status === "signing" ? "Signing…" : "Sign in"}
        </Button>
      )}

      {user && (
        <>
          <Badge tone="survive">{user.username}</Badge>
          <Button variant="plain" onClick={signOut}>
            Out
          </Button>
        </>
      )}

      {error && <Badge tone="eliminated">Auth failed</Badge>}
    </div>
  );
}
