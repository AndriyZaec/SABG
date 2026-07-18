import { useParams } from "react-router-dom";
import { useArenaSocket } from "../arena/live/useArenaSocket.js";
import { MatchHeader } from "../arena/live/MatchHeader.js";
import { PredictionCard } from "../arena/live/PredictionCard.js";
import { PendingPredictionsList } from "../arena/live/PendingPredictionsList.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";
import { WinnerBanner } from "../arena/live/WinnerBanner.js";
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

  // The current round is already shown in full by PredictionCard (incl. its locked-waiting
  // state) — this list is only the other rounds still awaiting settlement.
  const pending = (view.pendingPredictions ?? []).filter((p) => p.roundId !== view.round?.roundId);

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
          {view.myStatus === "winner" && <WinnerBanner />}
          <MatchHeader view={view} />
          {view.round && (
            // key={round.roundId} forces a fresh mount per round — PredictionCard's `picked`
            // state must not survive into the next round (it otherwise looks answered with no
            // answer ever having been sent for it).
            <PredictionCard
              key={view.round.roundId}
              round={view.round}
              onAnswer={submitAnswer}
              eliminated={view.myStatus === "eliminated"}
            />
          )}
          {pending.length > 0 && <PendingPredictionsList predictions={pending} />}
          <EliminationFeed feed={view.feed} />
        </div>
        <aside style={{ display: "grid", gap: 20 }}>
          <LeaderboardRail entries={view.leaderboard} />
        </aside>
      </div>
    </div>
  );
}
