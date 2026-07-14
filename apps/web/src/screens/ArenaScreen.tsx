import { useMemo } from "react";
import { makeDemoView } from "../arena/arenaView.js";
import { MatchHeader } from "../arena/live/MatchHeader.js";
import { PredictionCard } from "../arena/live/PredictionCard.js";

// 5d will replace the seeded view with a live WS-driven one.
export function ArenaScreen() {
  const view = useMemo(() => makeDemoView(), []);

  return (
    <div className="nb-container" style={{ display: "grid", gap: 20 }}>
      <MatchHeader view={view} />
      {view.round && <PredictionCard round={view.round} />}
    </div>
  );
}
