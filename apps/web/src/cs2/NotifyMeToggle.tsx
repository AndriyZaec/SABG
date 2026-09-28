import type { MouseEvent } from "react";
import { useCs2NotifyMe } from "./useCs2NotifyMe.js";

/** Icon-only bell for the upcoming-series queue. Hidden until a wallet is connected. */
export function NotifyMeToggle({ seriesId, initiallyFollowing }: { seriesId: string; initiallyFollowing: boolean }) {
  const { status, walletConnected, toggle } = useCs2NotifyMe(seriesId, initiallyFollowing);
  if (!walletConnected) return null;

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void toggle();
  };

  if (status === "subscribed") {
    return (
      <button
        type="button"
        className="cs2-notify-bell cs2-notify-bell--on"
        title="Notifications on — click to turn off"
        onClick={onClick}
      >
        🔔
      </button>
    );
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
