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

const sol = (lamports: number) => Number((lamports / 1_000_000_000).toFixed(3));

/** Entry / join state for the featured match — rendered docked into the lobby hero footer. */
export function EntryCard() {
  const { connected } = useWallet();
  const { arena } = useBackendArena();
  const { status, info, error, hasEntry, join } = useArenaEntry({
    ...(arena?.onchainArenaId != null ? { onchainArenaId: arena.onchainArenaId } : {}),
    ...(arena ? { backendArenaId: arena.id } : {}),
  });

  const busy = status === "working";
  const lobbyOpen = arena?.status === "lobby";

  // One action for the current state — joined wins over everything, then settled, then join/closed.
  let action: ReactNode;
  if (!connected) {
    action = <p className="nb-mono" style={{ margin: 0 }}>Connect a wallet in the top bar to join.</p>;
  } else if (hasEntry) {
    action = <div className="nb-hero__joined">✔ You&apos;re in — wait for kickoff</div>;
  } else if (info?.settled) {
    action = <Badge tone="neutral">Arena settled — see payout</Badge>;
  } else if (!arena) {
    action = <Loading label="Loading arena…" />;
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
    <>
      {arena && (
        <div className="nb-hero__stats">
          <Stat label="Entry" value={`${sol(arena.entryFeeLamports)} SOL`} />
          <Stat label="Prize pool" value={`${sol(arena.prizePoolLamports)} SOL`} />
          <Stat label="Players" value={String(arena.activePlayersCount)} />
        </div>
      )}
      {action}
      {error && <Badge tone="eliminated">{error}</Badge>}
    </>
  );
}
