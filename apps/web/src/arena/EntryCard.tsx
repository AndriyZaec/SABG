import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaEntry } from "./useArenaEntry.js";

/** Shows the demo arena and lets a connected wallet create it / buy an entry pass. */
export function EntryCard() {
  const { connected } = useWallet();
  const { status, error, info, hasEntry, createArena, buyEntry } = useArenaEntry();

  if (!connected) {
    return <p>Connect a wallet to join the arena.</p>;
  }

  const busy = status === "working" || status === "loading";

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, maxWidth: 360 }}>
      <h2>Demo Arena</h2>

      {info && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
          <dt>Entry fee</dt>
          <dd style={{ margin: 0 }}>{info.entryFeeSol} SOL</dd>
          <dt>Prize pool</dt>
          <dd style={{ margin: 0 }}>{info.prizePoolSol} SOL</dd>
          <dt>Players</dt>
          <dd style={{ margin: 0 }}>{info.playerCount}</dd>
        </dl>
      )}

      <div style={{ marginTop: 12 }}>
        {info && !info.exists && (
          <button onClick={createArena} disabled={busy}>
            {status === "working" ? "Creating…" : "Create arena"}
          </button>
        )}

        {info?.exists && !hasEntry && !info.settled && (
          <button onClick={buyEntry} disabled={busy}>
            {status === "working" ? "Buying…" : `Buy entry (${info.entryFeeSol} SOL)`}
          </button>
        )}

        {hasEntry && <p>✅ You're in. Waiting for kickoff.</p>}
        {info?.settled && <p>Arena settled.</p>}
      </div>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
    </section>
  );
}
