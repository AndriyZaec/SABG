import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "./AuthContext.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";

/** Wallet connect + sign-in control (lives in the masthead). */
export function SignInPanel() {
  const { connected, user, status, signIn, signOut } = useAuth();

  return (
    <div className="nb-row" style={{ gap: 10 }}>
      <WalletMultiButton />

      {/* Normal path auto-signs on connect; only surface a control if it failed. */}
      {connected && !user && status === "error" && (
        <Button variant="primary" onClick={signIn}>
          Retry sign-in
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
    </div>
  );
}
