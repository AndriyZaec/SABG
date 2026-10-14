import type { MouseEvent } from "react";
import { useCs2NotifyMe } from "./useCs2NotifyMe.js";

/** Icon-only bell, shown for connected wallets in browsers that support push. */
export function NotifyMeToggle({ seriesId, initiallyFollowing }: { seriesId: string; initiallyFollowing: boolean }) {
  const { status, busy, supported, walletConnected, toggle } = useCs2NotifyMe(seriesId, initiallyFollowing);
  if (!walletConnected || !supported) return null;

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
        disabled={busy}
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
      disabled={busy}
      title={status === "denied" ? "Notifications blocked" : "Notify me"}
      onClick={onClick}
    >
      🔕
    </button>
  );
}
