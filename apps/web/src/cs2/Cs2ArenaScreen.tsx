import type { Answer, Arena, Cs2Match, Cs2SeriesDetail } from "@arena/contracts";
import { Link, useParams } from "react-router-dom";
import { useCs2ArenaSocket } from "./live/useCs2ArenaSocket.js";
import { SeriesHeader } from "./live/SeriesHeader.js";
import { Cs2RoundCard } from "./live/Cs2RoundCard.js";
import { Cs2EntryCard } from "./Cs2EntryCard.js";
import { TeamLogo } from "./TeamLogo.js";
import { useCs2Series } from "./useCs2Catalog.js";
import { StreamPip } from "./stream/StreamPip.js";
import { streamEmbed } from "./stream/streamEmbed.js";
import { useCs2ArenaEntry } from "./useCs2ArenaEntry.js";
import { useCs2RoundAlerts, type Cs2NewRoundSignal } from "./live/useCs2RoundAlerts.js";
import { useCs2VictoryAlert } from "./live/useCs2VictoryAlert.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "./cs2View.js";
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

function Cs2ArenaLobby({
  arena,
  match,
  view,
  connected,
  answerSubmission,
  submitAnswer,
  newRoundSignal,
}: {
  arena: Arena;
  match: Cs2Match;
  view: Cs2ArenaView | null;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  newRoundSignal: Cs2NewRoundSignal | null;
}) {
  const [seriesResult] = useCs2Series(match.seriesId);
  const series = seriesResult.state === "ready" ? seriesResult.value : undefined;
  const teams = match.teamScores.map((team) => teamPresentation(team, series));
  const entry = useCs2ArenaEntry({
    ...(arena?.onchainArenaId != null ? { onchainArenaId: arena.onchainArenaId } : {}),
    backendArenaId: arena.id,
  });
  const [muted, toggleMuted] = useCs2RoundAlerts(newRoundSignal, entry.hasEntry);

  if (entry.hasEntry) {
    return (
      <div className="nb-container">
        <Link className="cs2-back cs2-back--spaced" to={`/cs2/series/${match.seriesId}`}>← Back to series</Link>
        <div className="nb-arena-grid">
          <div style={{ display: "grid", gap: 20 }}>
            {view?.round && (
              <Cs2RoundCard
                key={view.round.roundId}
                round={view.round}
                onAnswer={submitAnswer}
                submission={answerSubmission}
                connected={connected}
                eliminated={view?.myStatus === "eliminated"}
                participant
                muted={muted}
                onToggleMute={toggleMuted}
              />
            )}
            <EliminationFeed feed={view?.feed ?? []} />
          </div>
          <aside style={{ display: "grid", gap: 20 }}>
            <LeaderboardRail entries={view?.leaderboard ?? []} />
          </aside>
        </div>
      </div>
    );
  }

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
        <Cs2EntryCard arena={arena} entry={entry} />
      </Panel>
    </div>
  );
}

function Cs2SeriesStream({ seriesId }: { seriesId: string }) {
  const [seriesResult] = useCs2Series(seriesId);
  const streamUrl = seriesResult.state === "ready" ? seriesResult.value.streamUrl : undefined;
  const embed = streamUrl === undefined ? undefined : streamEmbed(streamUrl, window.location.hostname);
  return embed === undefined ? null : <StreamPip embed={embed} />;
}

export function Cs2ArenaScreen() {
  const { arenaId = "" } = useParams();
  const { detail, loadError, retry, view, connected, answerSubmission, submitAnswer, newRoundSignal, victorySignal } =
    useCs2ArenaSocket(arenaId);

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

  // Always the second child, so moving from lobby to live keeps the same player instead of reloading it.
  const withStream = (body: React.JSX.Element) => <>{body}<Cs2SeriesStream seriesId={match.seriesId} /></>;

  if (arena.status === "cancelled") {
    return withStream(
      <div className="nb-container">
        <Panel accent="red">This arena was cancelled ({arena.cancelledReason ?? "cancelled"}).</Panel>
      </div>,
    );
  }

  if (arena.status === "lobby") {
    return withStream(
      <Cs2ArenaLobby
        arena={arena}
        match={match}
        view={view}
        connected={connected}
        answerSubmission={answerSubmission}
        submitAnswer={submitAnswer}
        newRoundSignal={newRoundSignal}
      />,
    );
  }

  if (!view) {
    return withStream(<div className="nb-container"><Loading label="Loading arena…" /></div>);
  }

  if (view.cancelled) {
    return withStream(<div className="nb-container"><Panel accent="red">This arena was cancelled ({view.cancelled.reason}).</Panel></div>);
  }

  return withStream(
    <Cs2ArenaLive
      seriesId={match.seriesId}
      view={view}
      connected={connected}
      answerSubmission={answerSubmission}
      submitAnswer={submitAnswer}
      newRoundSignal={newRoundSignal}
      victorySignal={victorySignal}
    />,
  );
}

function Cs2ArenaLive({
  seriesId,
  view,
  connected,
  answerSubmission,
  submitAnswer,
  newRoundSignal,
  victorySignal,
}: {
  seriesId: string;
  view: Cs2ArenaView;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  newRoundSignal: Cs2NewRoundSignal | null;
  victorySignal: number;
}) {
  const isParticipant = view.myStatus !== undefined;
  const pending = (view.pendingPredictions ?? []).filter((prediction) => prediction.roundId !== view.round?.roundId);
  const [muted, toggleMuted] = useCs2RoundAlerts(newRoundSignal, isParticipant);
  useCs2VictoryAlert(victorySignal, muted);

  return (
    <div className="nb-container">
      <Link className="cs2-back cs2-back--spaced" to={`/cs2/series/${seriesId}`}>← Back to series</Link>
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
              muted={muted}
              onToggleMute={toggleMuted}
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
