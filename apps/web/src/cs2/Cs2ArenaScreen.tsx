import type { Answer, Arena, ArenaCancelledReason, Cs2Match, Cs2SeriesDetail } from "@arena/contracts";
import { useEffect, useState } from "react";
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
import { useCs2EliminationAlert } from "./live/useCs2EliminationAlert.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "./cs2View.js";
import { classicRoundScoring, classicZoneHud } from "./classicZone.js";
import { Cs2Survivors } from "./live/Cs2Survivors.js";
import { survivorsBoard } from "./survivorsBoard.js";
import { Cs2MatchFeed } from "./live/Cs2MatchFeed.js";
import { cs2FeedForView } from "./live/cs2Feed.js";
import { Cs2StageLayout } from "./stage/Cs2StageLayout.js";
import { PendingPredictionsList } from "../arena/live/PendingPredictionsList.js";
import { WinnerBanner } from "../arena/live/WinnerBanner.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";
import { Badge } from "../ui/Badge.js";

function Cs2ArenaCancelled({ arena, match, reason }: { arena: Arena; match: Cs2Match; reason: ArenaCancelledReason | undefined }) {
  const entry = useCs2ArenaEntry({
    ...(arena.onchainArenaId != null ? { onchainArenaId: arena.onchainArenaId } : {}),
    backendArenaId: arena.id,
  });
  return (
    <div className="nb-container">
      <Link className="cs2-back cs2-back--spaced" to={`/cs2/series/${match.seriesId}`}>← Back to series</Link>
      <Panel title="Arena cancelled" accent="red">
        <p>{reason === "insufficient_players"
          ? "At least 2 players are required to start an arena."
          : "This arena did not take place."}</p>
        <p>Paid entries will be refunded in full.</p>
        {entry.entryRefunded
          ? <Badge tone="neutral">Entry refunded</Badge>
          : entry.hasEntry && <Badge tone="neutral">Refund processing</Badge>}
      </Panel>
    </div>
  );
}

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
  series,
  muted,
  onToggleMute,
  onEntryChange,
}: {
  arena: Arena;
  match: Cs2Match;
  view: Cs2ArenaView | null;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  series?: Cs2SeriesDetail;
  muted: boolean;
  onToggleMute: () => void;
  onEntryChange: (hasEntry: boolean) => void;
}) {
  const teams = match.teamScores.map((team) => teamPresentation(team, series));
  const entry = useCs2ArenaEntry({
    ...(arena?.onchainArenaId != null ? { onchainArenaId: arena.onchainArenaId } : {}),
    backendArenaId: arena.id,
  });
  const zoneHud = view?.round ? classicZoneHud(view) : undefined;
  useEffect(() => { onEntryChange(entry.hasEntry); }, [entry.hasEntry, onEntryChange]);

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
                onToggleMute={onToggleMute}
                classic={classicRoundScoring(view, view.round.roundNumber)}
              />
            )}
            <Cs2MatchFeed items={view ? cs2FeedForView(view) : []} />
          </div>
          <aside style={{ display: "grid", gap: 20 }}>
            <Cs2Survivors
              board={survivorsBoard(view?.leaderboard ?? [], zoneHud)}
              active={view?.survivors ?? 0}
              total={view?.totalPlayers ?? 0}
            />
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

export function Cs2ArenaScreen() {
  const { arenaId = "" } = useParams();
  const { detail, loadError, retry, view, connected, answerSubmission, submitAnswer, newRoundSignal, victorySignal, eliminationSignal } =
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

  return (
    <Cs2ArenaSession
      arena={arena}
      match={match}
      view={view}
      connected={connected}
      answerSubmission={answerSubmission}
      submitAnswer={submitAnswer}
      newRoundSignal={newRoundSignal}
      victorySignal={victorySignal}
      eliminationSignal={eliminationSignal}
    />
  );
}

/** One owner for series data, sounds and the player throughout lobby → live → finish. */
function Cs2ArenaSession({
  arena,
  match,
  view,
  connected,
  answerSubmission,
  submitAnswer,
  newRoundSignal,
  victorySignal,
  eliminationSignal,
}: {
  arena: Arena;
  match: Cs2Match;
  view: Cs2ArenaView | null;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  newRoundSignal: Cs2NewRoundSignal | null;
  victorySignal: number;
  eliminationSignal: number;
}) {
  // Refresh live metadata so a stream URL set after the arena opened appears without a reload.
  const [seriesResult] = useCs2Series(match.seriesId, true);
  const series = seriesResult.state === "ready" ? seriesResult.value : undefined;
  const embed = series?.streamUrl === undefined ? undefined : streamEmbed(series.streamUrl, window.location.hostname);
  const [lobbyHasEntry, setLobbyHasEntry] = useState(false);
  const [muted, toggleMuted] = useCs2RoundAlerts(newRoundSignal, lobbyHasEntry || view?.myStatus !== undefined);
  useCs2VictoryAlert(victorySignal, muted);
  useCs2EliminationAlert(eliminationSignal, muted);

  if (!view) return <div className="nb-container"><Loading label="Loading arena…" /></div>;

  const standbyContent = arena.status === "cancelled" || view.cancelled
    ? <Cs2ArenaCancelled arena={arena} match={match} reason={arena.cancelledReason ?? view.cancelled?.reason} />
    : arena.status === "lobby"
      ? <Cs2ArenaLobby arena={arena} match={match} view={view} connected={connected} answerSubmission={answerSubmission} submitAnswer={submitAnswer} series={series} muted={muted} onToggleMute={toggleMuted} onEntryChange={setLobbyHasEntry} />
      : seriesResult.state === "loading"
        ? <div className="nb-container"><Loading label="Loading broadcast…" /></div>
        : !embed
          ? <Cs2ArenaLive seriesId={match.seriesId} view={view} connected={connected} answerSubmission={answerSubmission} submitAnswer={submitAnswer} muted={muted} onToggleMute={toggleMuted} />
          : undefined;
  const map = series?.maps.find((candidate) => candidate.seriesMatchIndex === match.seriesMatchIndex);

  return (
    <Cs2StageLayout
      view={view}
      connected={connected}
      answerSubmission={answerSubmission}
      submitAnswer={submitAnswer}
      muted={muted}
      onToggleMute={toggleMuted}
      seriesId={match.seriesId}
      embed={embed}
      teams={[teamPresentation(match.teamScores[0], series), teamPresentation(match.teamScores[1], series)]}
      competition={series?.competition}
      format={series?.format ?? view.seriesFormat}
      map={{ seriesMatchIndex: match.seriesMatchIndex, ...(map?.mapName !== undefined ? { mapName: map.mapName } : {}) }}
      stream={embed ? <StreamPip embed={embed} inline={standbyContent === undefined} /> : undefined}
      standbyContent={standbyContent}
    />
  );
}

/** Previous live presentation, retained for arenas without a playable stream. */
function Cs2ArenaLive({
  seriesId, view, connected, answerSubmission, submitAnswer, muted, onToggleMute,
}: {
  seriesId: string;
  view: Cs2ArenaView;
  connected: boolean;
  answerSubmission: Cs2AnswerSubmission;
  submitAnswer: (answer: Answer) => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const isParticipant = view.myStatus !== undefined;
  const pending = (view.pendingPredictions ?? []).filter((prediction) => prediction.roundId !== view.round?.roundId);
  const zoneHud = classicZoneHud(view);

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
              onToggleMute={onToggleMute}
              classic={classicRoundScoring(view, view.round.roundNumber)}
            />
          )}
          {pending.length > 0 && <PendingPredictionsList predictions={pending} />}
          <Cs2MatchFeed items={cs2FeedForView(view)} />
        </div>
        <aside style={{ display: "grid", gap: 20 }}>
          <Cs2Survivors board={survivorsBoard(view.leaderboard, zoneHud)} active={view.survivors} total={view.totalPlayers} />
        </aside>
      </div>
    </div>
  );
}
