import type { Arena, Cs2Match, Cs2SeriesDetail } from "@arena/contracts";
import { Link, useParams } from "react-router-dom";
import { useCs2ArenaSocket } from "./live/useCs2ArenaSocket.js";
import { SeriesHeader } from "./live/SeriesHeader.js";
import { Cs2RoundCard } from "./live/Cs2RoundCard.js";
import { Cs2EntryCard } from "./Cs2EntryCard.js";
import { TeamLogo } from "./TeamLogo.js";
import { useCs2Series } from "./useCs2Catalog.js";
import { EliminationFeed } from "../arena/live/EliminationFeed.js";
import { LeaderboardRail } from "../arena/live/LeaderboardRail.js";
import { PendingPredictionsList } from "../arena/live/PendingPredictionsList.js";
import { WinnerBanner } from "../arena/live/WinnerBanner.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";

function teamPresentation(team: Cs2Match["teamScores"][number], series?: Cs2SeriesDetail) {
  const participant = series?.participants.find(
    (candidate) => candidate.state === "known" && candidate.team.id === team.teamId,
  );
  if (participant?.state === "known") {
    return {
      name: participant.team.shortName ?? participant.team.name.replace(/^Team\s+/i, ""),
      logoUrl: participant.team.logoUrl,
    };
  }
  return { name: team.name.replace(/^Team\s+/i, ""), logoUrl: undefined };
}

function Cs2ArenaLobby({ arena, match }: { arena: Arena; match: Cs2Match }) {
  const [seriesResult] = useCs2Series(match.seriesId);
  const series = seriesResult.state === "ready" ? seriesResult.value : undefined;
  const teams = match.teamScores.map((team) => teamPresentation(team, series));

  return (
    <div className="nb-container" style={{ display: "grid", gap: 22 }}>
      <Link className="cs2-back" to={`/cs2/series/${match.seriesId}`}>← Back to series</Link>
      <Panel title={`Map ${match.seriesMatchIndex} lobby`} accent="blue">
        <div className="cs2-arena-lobby__matchup">
          {teams.map((team, index) => (
            <div className={`cs2-arena-lobby__team${index === 1 ? " cs2-arena-lobby__team--right" : ""}`} key={team.name}>
              <TeamLogo name={team.name} {...(team.logoUrl ? { src: team.logoUrl } : {})} />
              <strong>{team.name}</strong>
            </div>
          ))}
          <span className="cs2-arena-lobby__versus cs2-versus-badge">VS</span>
        </div>
        <Cs2EntryCard arena={arena} />
      </Panel>
    </div>
  );
}

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
    return <Cs2ArenaLobby arena={arena} match={match} />;
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
