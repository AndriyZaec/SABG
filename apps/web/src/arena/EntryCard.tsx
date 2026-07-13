import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaEntry } from "./useArenaEntry.js";
import { useBackendArena } from "./useBackendArena.js";
import { Loading } from "../ui/Loading.js";

/** Shows the target arena and lets a connected wallet create it (demo) / buy an entry pass. */
export function EntryCard() {
  const { connected } = useWallet();
  const { arena: backendArena } = useBackendArena();
  const { status, error, info, hasEntry, createArena, buyEntry } = useArenaEntry({
    ...(backendArena?.onchainArenaId != null ? { onchainArenaId: backendArena.onchainArenaId } : {}),
    ...(backendArena ? { backendArenaId: backendArena.id } : {}),
  });

  if (!connected) {
    return <p>Connect a wallet to join the arena.</p>;
  }

  if (status === "loading" && !info) {
    return <Loading label="Loading arena…" />;
  }

  const busy = status === "working" || status === "loading";
  // Players don't create arenas in prod — the backend provisions them as on-chain authority.
  // Kept as a dev/demo affordance; set VITE_ALLOW_CLIENT_ARENA=false to hide it.
  const allowClientCreate = import.meta.env.VITE_ALLOW_CLIENT_ARENA !== "false";

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
        {info && !info.exists && allowClientCreate && (
          <button onClick={createArena} disabled={busy}>
            {status === "working" ? "Creating…" : "Create arena"}
          </button>
        )}

        {info && !info.exists && !allowClientCreate && <p>Waiting for an arena to open…</p>}

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
