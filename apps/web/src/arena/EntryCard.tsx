import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaEntry } from "./useArenaEntry.js";
import { useBackendArena } from "./useBackendArena.js";
import { DEMO_VIEW } from "./arenaView.js";
import { Panel } from "../ui/Panel.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { Loading } from "../ui/Loading.js";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "var(--bw) solid var(--ink)", background: "var(--paper)", padding: "10px 12px" }}>
      <div className="nb-label">{label}</div>
      <div className="nb-stat" style={{ fontSize: "1.6rem" }}>{value}</div>
    </div>
  );
}

/** Shows the target arena and lets a connected wallet create it (demo) / buy an entry pass. */
export function EntryCard() {
  const { connected } = useWallet();
  const { arena: backendArena, match } = useBackendArena();
  const { status, error, info, hasEntry, createArena, buyEntry } = useArenaEntry({
    ...(backendArena?.onchainArenaId != null ? { onchainArenaId: backendArena.onchainArenaId } : {}),
    ...(backendArena ? { backendArenaId: backendArena.id } : {}),
  });

  // Name the fixture this arena runs against; fall back to the demo match (same as the lobby hero)
  // so the card always reads as tied to a match, never a generic "Match Arena".
  const fixture = match ?? { homeTeam: DEMO_VIEW.home, awayTeam: DEMO_VIEW.away };
  const title = `${fixture.homeTeam} – ${fixture.awayTeam}`;

  if (!connected) {
    return (
      <Panel title={title} accent="yellow">
        <p className="nb-mono">Connect a wallet in the top bar to join the arena.</p>
      </Panel>
    );
  }

  if (status === "loading" && !info) {
    return (
      <Panel title={title} accent="yellow">
        <Loading label="Loading arena…" />
      </Panel>
    );
  }

  const busy = status === "working" || status === "loading";
  // Players don't create arenas in prod — the backend provisions them as on-chain authority.
  const allowClientCreate = import.meta.env.VITE_ALLOW_CLIENT_ARENA !== "false";

  return (
    <Panel title={title} accent="yellow" className="nb-rise">
      {info && (
        <div
          className="nb-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(96px,1fr))", marginBottom: 16 }}
        >
          <Stat label="Entry" value={`${info.entryFeeSol} SOL`} />
          <Stat label="Prize pool" value={`${info.prizePoolSol} SOL`} />
          <Stat label="Players" value={String(info.playerCount)} />
        </div>
      )}

      {info && !info.exists && allowClientCreate && (
        <Button variant="primary" block onClick={createArena} disabled={busy}>
          {status === "working" ? "Creating…" : "Create arena"}
        </Button>
      )}

      {info && !info.exists && !allowClientCreate && (
        <Badge tone="neutral">Waiting for an arena to open…</Badge>
      )}

      {info?.exists && !hasEntry && !info.settled && (
        <Button variant="survive" lg block onClick={buyEntry} disabled={busy}>
          {status === "working" ? "Buying…" : `Buy entry — ${info.entryFeeSol} SOL`}
        </Button>
      )}

      {hasEntry && (
        <div
          className="nb-bg--green"
          style={{
            border: "var(--bw) solid var(--ink)",
            padding: "14px",
            textAlign: "center",
            fontFamily: "var(--font-display)",
            textTransform: "uppercase",
            fontSize: "1.4rem",
          }}
        >
          ✔ You&apos;re in — wait for kickoff
        </div>
      )}

      {info?.settled && <Badge tone="neutral">Arena settled</Badge>}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Badge tone="eliminated">{error}</Badge>
        </div>
      )}
    </Panel>
  );
}
