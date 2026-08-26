import { Link, useParams } from "react-router-dom";
import { useCs2ArenaSocket } from "./live/useCs2ArenaSocket.js";
import { SeriesHeader } from "./live/SeriesHeader.js";
import { Cs2RoundCard } from "./live/Cs2RoundCard.js";
import { Cs2EntryCard } from "./Cs2EntryCard.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";
import { PendingPredictionsList } from "../arena/live/PendingPredictionsList.js";
import { WinnerBanner } from "../arena/live/WinnerBanner.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";

export function Cs2ArenaScreen() {
  const { arenaId = "" } = useParams();
  const { detail, loadError, retry, view, connected, answerSubmission, submitAnswer } = useCs2ArenaSocket(arenaId);

  if (!arenaId) {
    return (
      <div className="nb-container">
        <Panel accent="red">No CS2 arena id in the URL.</Panel>
      </div>
    );
  }

  if (!detail && !loadError) {
    return <div className="nb-container"><Loading label="Loading arena…" /></div>;
  }

  if (!detail) {
    return (
      <div className="nb-container">
        <Panel title="Arena unavailable" accent="red">
          <div className="cs2-state__actions">
            <button className="nb-btn nb-btn--primary" type="button" onClick={retry}>Try again</button>
            <Link className="nb-btn nb-btn--plain" to="/">All series</Link>
          </div>
        </Panel>
      </div>
    );
  }

  const { arena, match } = detail;
  if (match.discipline !== "cs2") {
    return <div className="nb-container"><Panel accent="red">This is not a CS2 arena.</Panel></div>;
  }

  if (arena.status === "cancelled") {
    return (
      <div className="nb-container">
        <Panel accent="red">This arena was cancelled ({arena.cancelledReason ?? "cancelled"}).</Panel>
      </div>
    );
  }

  if (arena.status === "lobby") {
    const [first, second] = match.teamScores;
    return (
      <div className="nb-container" style={{ display: "grid", gap: 22 }}>
        <Link className="cs2-back" to={`/cs2/series/${match.seriesId}`}>← Back to series</Link>
        <Panel title={`Map ${match.seriesMatchIndex} lobby`} accent="blue">
          <p className="nb-teamname" style={{ marginBottom: 14 }}>{first.name} vs {second.name}</p>
          <Cs2EntryCard arena={arena} />
        </Panel>
      </div>
    );
  }

  if (!view) {
    return <div className="nb-container"><Loading label="Loading arena…" /></div>;
  }

  if (view.cancelled) {
    return <div className="nb-container"><Panel accent="red">This arena was cancelled ({view.cancelled.reason}).</Panel></div>;
  }

  const isParticipant = view.myStatus !== undefined;
  const pending = (view.pendingPredictions ?? []).filter((prediction) => prediction.roundId !== view.round?.roundId);

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
              submission={answerSubmission}
              connected={connected}
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
