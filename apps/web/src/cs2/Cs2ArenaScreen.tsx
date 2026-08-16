import { useParams } from "react-router-dom";
import { useCs2ArenaSocket } from "./live/useCs2ArenaSocket.js";
import { SeriesHeader } from "./live/SeriesHeader.js";
import { Cs2RoundCard } from "./live/Cs2RoundCard.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";
import { PendingPredictionsList } from "../arena/live/PendingPredictionsList.js";
import { WinnerBanner } from "../arena/live/WinnerBanner.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";

// CS2's analog of screens/ArenaScreen.tsx. No "demo" arenaId fallback — there is no seeded CS2
// demo fixture.
export function Cs2ArenaScreen() {
  const { arenaId } = useParams();
  const { view, connected, submitAnswer } = useCs2ArenaSocket(arenaId ?? "");

  if (!arenaId) {
    return (
      <div className="nb-container">
        <Panel accent="red">No CS2 arena id in the URL.</Panel>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="nb-container">
        <Loading label="Loading arena…" />
      </div>
    );
  }

  if (view.cancelled) {
    return (
      <div className="nb-container">
        <Panel accent="red">This arena was cancelled ({view.cancelled.reason}).</Panel>
      </div>
    );
  }

  // Same spectator concept as soccer's ArenaScreen: a viewer without a personal player.status
  // push (never joined) is a spectator — no answer buttons. CS2 has no join flow wired up yet
  // (deliberately out of scope, see the plan), so this is effectively always true for now.
  const isParticipant = view.myStatus !== undefined;

  // The current round is already shown in full by Cs2RoundCard — this list is only the other
  // rounds still awaiting settlement (the cascading-generation overlap: N locked, N+1 open).
  const pending = (view.pendingPredictions ?? []).filter((p) => p.roundId !== view.round?.roundId);

  return (
    <div className="nb-container">
      {!connected && (
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
          <SeriesHeader view={view} />
          {view.round && (
            <Cs2RoundCard
              key={view.round.roundId}
              round={view.round}
              onAnswer={submitAnswer}
              eliminated={view.myStatus === "eliminated"}
              participant={isParticipant}
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
