import type { Arena } from "@arena/contracts";
import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCs2ArenaEntry } from "./useCs2ArenaEntry.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="nb-hero__stat">
      <div className="nb-label">{label}</div>
      <div className="nb-stat" style={{ fontSize: "1.4rem" }}>{value}</div>
    </div>
  );
}

const sol = (lamports: number) => Number((lamports / 1_000_000_000).toFixed(3));

export function Cs2EntryCard({ arena }: { arena: Arena }) {
  const { connected } = useWallet();
  const { status, info, error, hasEntry, entryRefunded, join } = useCs2ArenaEntry({
    ...(arena?.onchainArenaId != null ? { onchainArenaId: arena.onchainArenaId } : {}),
    backendArenaId: arena.id,
  });

  const busy = status === "working";
  const lobbyOpen = arena.status === "lobby";

  let action: ReactNode;
  if (!connected) {
    action = <p className="nb-mono" style={{ margin: 0 }}>Connect a wallet in the top bar to join.</p>;
  } else if (info?.state === "cancelled") {
    action = (
      <Badge tone="neutral">
        {entryRefunded ? "Arena cancelled — entry refunded" : hasEntry ? "Arena cancelled — refund processing" : "Arena cancelled"}
      </Badge>
    );
  } else if (hasEntry) {
    action = <div className="nb-hero__joined">✔ You&apos;re in — wait for kickoff</div>;
  } else if (info?.state === "settled") {
    action = <Badge tone="neutral">Arena settled — see payout</Badge>;
  } else if (!lobbyOpen) {
    action = <Badge tone="neutral">Lobby closed — arena in progress</Badge>;
  } else {
    action = (
      <Button variant="survive" lg block onClick={join} disabled={busy}>
        {busy ? "Joining…" : `Join — ${sol(arena.entryFeeLamports)} SOL`}
      </Button>
    );
  }

  return (
    <div className="cs2-entry-card">
      <div className="nb-hero__stats">
        <Stat label="Entry" value={`${sol(arena.entryFeeLamports)} SOL`} />
        <Stat label="Prize pool" value={`${sol(arena.prizePoolLamports)} SOL`} />
        <Stat label="Players" value={String(arena.activePlayersCount)} />
      </div>
      {action}
      {error && <Badge tone="eliminated">{error}</Badge>}
    </div>
  );
}
