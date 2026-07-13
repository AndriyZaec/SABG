import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SignInPanel } from "../auth/SignInPanel.js";
import { useArenaPayout } from "../arena/useArenaPayout.js";
import { useBackendArena } from "../arena/useBackendArena.js";
import { Loading } from "../ui/Loading.js";

export function PayoutScreen() {
  const { connected, publicKey } = useWallet();
  const { arena: backendArena } = useBackendArena();
  const { status, error, exists, prizePoolSol, settled, isPayoutAuthority, settle } = useArenaPayout(
    backendArena?.onchainArenaId != null ? { onchainArenaId: backendArena.onchainArenaId } : {},
  );
  const [winners, setWinners] = useState("");

  const selfAddress = publicKey?.toBase58() ?? "";
  const winnerList = winners.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  return (
    <main style={{ padding: 24, display: "grid", gap: 16, maxWidth: 480 }}>
      <h1>Winner / Payout</h1>
      <SignInPanel />

      {!connected && <p>Connect a wallet.</p>}

      {connected && status === "loading" && <Loading label="Loading payout…" />}

      {connected && status !== "loading" && !exists && (
        <p>No arena yet — create one in the lobby first.</p>
      )}

      {connected && exists && (
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <p>
            Prize pool: <strong>{prizePoolSol} SOL</strong>
          </p>
          <p>Status: {settled ? "✅ Settled — paid out" : "In play"}</p>

          {!settled && isPayoutAuthority && (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                Winner address(es) — comma/space separated; split equally
                <textarea
                  value={winners}
                  onChange={(e) => setWinners(e.target.value)}
                  rows={2}
                  placeholder={selfAddress}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setWinners(selfAddress)}>Use my address</button>
                <button
                  onClick={() => settle(winnerList.length ? winnerList : [selfAddress])}
                  disabled={status === "working"}
                >
                  {status === "working" ? "Settling…" : "Settle & pay out"}
                </button>
              </div>
            </div>
          )}

          {!settled && !isPayoutAuthority && (
            <p>Only the payout authority can settle this arena.</p>
          )}

          {error && (
            <p role="alert" style={{ color: "crimson" }}>
              {error}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
