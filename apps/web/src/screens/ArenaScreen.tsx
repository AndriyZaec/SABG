import { DEMO_VIEW } from "../arena/arenaView.js";
import { MatchHeader } from "../arena/live/MatchHeader.js";

// 5d will replace DEMO_VIEW with a live WS-driven view.
export function ArenaScreen() {
  const view = DEMO_VIEW;

  return (
    <div className="nb-container" style={{ display: "grid", gap: 20 }}>
      <MatchHeader view={view} />
    </div>
  );
}
