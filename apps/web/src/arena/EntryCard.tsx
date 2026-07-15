import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useArenaEntry } from "./useArenaEntry.js";
import { useBackendArena } from "./useBackendArena.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { Loading } from "../ui/Loading.js";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="nb-hero__stat">
      <div className="nb-label">{label}</div>
      <div className="nb-stat" style={{ fontSize: "1.4rem" }}>{value}</div>
    </div>
  );
}

/** Entry / join state for the featured match — rendered docked into the lobby hero footer. */
export function EntryCard() {
  const { connected } = useWallet();
  const { arena: backendArena } = useBackendArena();
  const { status, error, info, hasEntry, createArena, buyEntry } = useArenaEntry({
    ...(backendArena?.onchainArenaId != null ? { onchainArenaId: backendArena.onchainArenaId } : {}),
    ...(backendArena ? { backendArenaId: backendArena.id } : {}),
  });

  const busy = status === "working" || status === "loading";
  // Players don't create arenas in prod — the backend provisions them as on-chain authority.
  const allowClientCreate = import.meta.env.VITE_ALLOW_CLIENT_ARENA !== "false";

  // Exactly one action/status for the current state — settled wins over joined, joined over buy.
  let action: ReactNode;
  if (!connected) {
    action = <p className="nb-mono" style={{ margin: 0 }}>Connect a wallet in the top bar to join.</p>;
  } else if (status === "loading" && !info) {
    action = <Loading label="Loading arena…" />;
  } else if (info?.settled) {
    action = <Badge tone="neutral">Arena settled — see payout</Badge>;
  } else if (hasEntry) {
    action = <div className="nb-hero__joined">✔ You&apos;re in — wait for kickoff</div>;
  } else if (info && !info.exists) {
    action = allowClientCreate ? (
      <Button variant="primary" block onClick={createArena} disabled={busy}>
        {status === "working" ? "Creating…" : "Create arena"}
      </Button>
    ) : (
      <Badge tone="neutral">Waiting for an arena to open…</Badge>
    );
  } else if (info?.exists) {
    action = (
      <Button variant="survive" lg block onClick={buyEntry} disabled={busy}>
        {status === "working" ? "Buying…" : `Buy entry — ${info.entryFeeSol} SOL`}
      </Button>
    );
  }

  return (
    <>
      {info && (
        <div className="nb-hero__stats">
          <Stat label="Entry" value={`${info.entryFeeSol} SOL`} />
          <Stat label="Prize pool" value={`${info.prizePoolSol} SOL`} />
          <Stat label="Players" value={String(info.playerCount)} />
        </div>
      )}
      {action}
      {error && <Badge tone="eliminated">{error}</Badge>}
    </>
  );
}
