import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaPayout } from "../arena/useArenaPayout.js";
import { useBackendArena } from "../arena/useBackendArena.js";
import { Panel } from "../ui/Panel.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
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
    <div className="nb-container" style={{ maxWidth: 560, display: "grid", gap: 20 }}>
      <h1>Winner / Payout</h1>

      {!connected && <p className="nb-mono">Connect a wallet in the top bar.</p>}

      {connected && status === "loading" && <Loading label="Loading payout…" />}

      {connected && status !== "loading" && !exists && (
        <p className="nb-mono">No arena yet — create one in the lobby first.</p>
      )}

      {connected && exists && (
        <Panel title="Prize Pool" accent={settled ? "green" : "yellow"} className="nb-rise">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span className="nb-stat">{prizePoolSol}</span>
            <span className="nb-display" style={{ fontSize: "1.4rem" }}>SOL</span>
            <span style={{ marginLeft: "auto" }}>
              {settled ? <Badge tone="survive">Paid out</Badge> : <Badge tone="live">In play</Badge>}
            </span>
          </div>

          {settled && (
            <div
              className="nb-bg--green"
              style={{
                marginTop: 16,
                border: "var(--bw) solid var(--ink)",
                padding: "16px",
                textAlign: "center",
                fontFamily: "var(--font-display)",
                textTransform: "uppercase",
                fontSize: "1.5rem",
              }}
            >
              ✔ Pool paid out to winners
            </div>
          )}

          {!settled && isPayoutAuthority && (
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="nb-label">Winner address(es) — comma/space separated, split equally</span>
                <textarea
                  className="nb-input"
                  value={winners}
                  onChange={(e) => setWinners(e.target.value)}
                  rows={2}
                  placeholder={selfAddress}
                />
              </label>
              <div className="nb-row">
                <Button variant="plain" onClick={() => setWinners(selfAddress)}>
                  Use my address
                </Button>
                <Button
                  variant="survive"
                  onClick={() => settle(winnerList.length ? winnerList : [selfAddress])}
                  disabled={status === "working"}
                >
                  {status === "working" ? "Settling…" : "Settle & pay out"}
                </Button>
              </div>
            </div>
          )}

          {!settled && !isPayoutAuthority && (
            <p className="nb-label" style={{ marginTop: 16 }}>
              Only the payout authority can settle this arena.
            </p>
          )}

          {error && (
            <div style={{ marginTop: 14 }}>
              <Badge tone="eliminated">{error}</Badge>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
