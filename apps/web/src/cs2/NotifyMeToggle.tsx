import type { MouseEvent } from "react";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { useCs2NotifyMe } from "./useCs2NotifyMe.js";

/** Icon-only variant for tight spaces (e.g. the upcoming-series queue). Hidden until a wallet is connected. */
function CompactNotifyMeToggle({ seriesId }: { seriesId: string }) {
  const { status, walletConnected, toggle } = useCs2NotifyMe(seriesId);
  if (!walletConnected) return null;

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void toggle();
  };

  if (status === "subscribed") {
    return <span className="cs2-notify-bell cs2-notify-bell--on" title="Notifications on">🔔</span>;
  }
  return (
    <button
      type="button"
      className="cs2-notify-bell"
      disabled={status === "working"}
      title={status === "denied" ? "Notifications blocked" : "Notify me"}
      onClick={onClick}
    >
      {status === "working" ? "…" : "🔕"}
    </button>
  );
}

function FullNotifyMeToggle({ seriesId }: { seriesId: string }) {
  const { status, walletConnected, toggle } = useCs2NotifyMe(seriesId);

  if (!walletConnected) {
    return <span className="nb-label">Connect a wallet in the top bar to get notified.</span>;
  }
  if (status === "subscribed") {
    return <Badge tone="survive">Notifications on</Badge>;
  }
  return (
    <div>
      <Button variant="plain" onClick={toggle} disabled={status === "working"}>
        {status === "working" ? "Enabling…" : "Notify me"}
      </Button>
      {status === "denied" && <p className="nb-label">Notifications blocked — allow them in your browser settings.</p>}
      {status === "error" && <p className="nb-label">Couldn&apos;t enable notifications — try again.</p>}
    </div>
  );
}

export function NotifyMeToggle({ seriesId, compact = false }: { seriesId: string; compact?: boolean }) {
  return compact ? <CompactNotifyMeToggle seriesId={seriesId} /> : <FullNotifyMeToggle seriesId={seriesId} />;
}
