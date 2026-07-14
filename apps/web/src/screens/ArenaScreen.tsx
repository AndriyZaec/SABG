import { useMemo } from "react";
import { makeDemoView } from "../arena/arenaView.js";
import { MatchHeader } from "../arena/live/MatchHeader.js";
import { PredictionCard } from "../arena/live/PredictionCard.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";

// 5d will replace the seeded view with a live WS-driven one.
export function ArenaScreen() {
  const view = useMemo(() => makeDemoView(), []);

  return (
    <div className="nb-container">
      <div className="nb-arena-grid">
        <div style={{ display: "grid", gap: 20 }}>
          <MatchHeader view={view} />
          {view.round && <PredictionCard round={view.round} />}
          <EliminationFeed feed={view.feed} />
        </div>
        <aside style={{ display: "grid", gap: 20 }}>
          <LeaderboardRail entries={view.leaderboard} />
        </aside>
      </div>
    </div>
  );
}
