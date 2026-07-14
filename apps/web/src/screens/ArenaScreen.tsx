import { useParams } from "react-router-dom";
import { useArenaSocket } from "../arena/live/useArenaSocket.js";
import { MatchHeader } from "../arena/live/MatchHeader.js";
import { PredictionCard } from "../arena/live/PredictionCard.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";
import { Loading } from "../ui/Loading.js";

export function ArenaScreen() {
  const { arenaId = "demo" } = useParams();
  const { view, connected, submitAnswer } = useArenaSocket(arenaId);
  const isDemo = arenaId === "demo";

  if (!view) {
    return (
      <div className="nb-container">
        <Loading label="Loading arena…" />
      </div>
    );
  }

  return (
    <div className="nb-container">
      {!isDemo && !connected && (
        <div
          className="nb-bg--yellow"
          style={{
            border: "var(--bw) solid var(--ink)",
            boxShadow: "var(--shadow-sm)",
            padding: "10px 14px",
            marginBottom: 16,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Sign in (top bar) to go live →
        </div>
      )}
      <div className="nb-arena-grid">
        <div style={{ display: "grid", gap: 20 }}>
          <MatchHeader view={view} />
          {view.round && <PredictionCard round={view.round} onAnswer={submitAnswer} />}
          <EliminationFeed feed={view.feed} />
        </div>
        <aside style={{ display: "grid", gap: 20 }}>
          <LeaderboardRail entries={view.leaderboard} />
        </aside>
      </div>
    </div>
  );
}
