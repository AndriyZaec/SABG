import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaPayout } from "../arena/useArenaPayout.js";
import { useBackendArena } from "../arena/useBackendArena.js";
import { Panel } from "../ui/Panel.js";
import { Badge } from "../ui/Badge.js";
import { Loading } from "../ui/Loading.js";

export function PayoutScreen() {
  const { connected } = useWallet();
  const { arena: backendArena } = useBackendArena();
  const { status, error, exists, prizePoolSol, settled, cancelled, settling } = useArenaPayout(
    backendArena?.onchainArenaId != null ? { onchainArenaId: backendArena.onchainArenaId } : {},
  );

  return (
    <div className="nb-container" style={{ maxWidth: 560, display: "grid", gap: 20 }}>
      <h1>Winner / Payout</h1>

      {!connected && <p className="nb-mono">Connect a wallet in the top bar.</p>}

      {connected && status === "loading" && <Loading label="Loading payout…" />}

      {connected && status !== "loading" && !exists && (
        <p className="nb-mono">No arena yet — create one in the lobby first.</p>
      )}

      {connected && exists && (
        <Panel title="Prize Pool" accent={settled ? "green" : cancelled ? "red" : "yellow"} className="nb-rise">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span className="nb-stat">{prizePoolSol}</span>
            <span className="nb-display" style={{ fontSize: "1.4rem" }}>SOL</span>
            <span style={{ marginLeft: "auto" }}>
              {settled ? (
                <Badge tone="survive">Paid out</Badge>
              ) : cancelled ? (
                <Badge tone="neutral">Cancelled</Badge>
              ) : (
                 <Badge tone="live">{settling ? "Paying out" : "In play"}</Badge>
              )}
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

          {cancelled && (
            <p className="nb-label" style={{ marginTop: 16 }}>
              Arena cancelled — entries are refunded individually.
            </p>
          )}

          {!settled && !cancelled && (
            <p className="nb-label" style={{ marginTop: 16 }}>
              Payout runs automatically after results are finalized.
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
