import type { Cs2SeriesAvailability, Cs2SeriesMapSummary, Cs2SeriesParticipant } from "@arena/contracts";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../ui/Badge.js";
import { Loading } from "../ui/Loading.js";
import { TeamLogo } from "./TeamLogo.js";
import { useCs2Series } from "./useCs2Catalog.js";

function participantName(participant: Cs2SeriesParticipant): string {
  return participant.state === "known" ? (participant.team.shortName ?? participant.team.name) : "TBD";
}

function mapScore(map: Cs2SeriesMapSummary, teamId: string | undefined): number {
  if (map.state === "pending" || teamId === undefined) return 0;
  return map.teams.find((team) => team.teamId === teamId)?.score ?? 0;
}

function mapTone(state: Cs2SeriesMapSummary["state"]): "live" | "survive" | "eliminated" | "neutral" {
  if (state === "live") return "live";
  if (state === "lobby") return "survive";
  if (state === "cancelled") return "eliminated";
  return "neutral";
}

function MapRow({
  map,
  participants,
  format,
  availability,
}: {
  map: Cs2SeriesMapSummary;
  participants: [Cs2SeriesParticipant, Cs2SeriesParticipant];
  format: number;
  availability: Cs2SeriesAvailability;
}) {
  const [first, second] = participants;
  const firstId = first.state === "known" ? first.team.id : undefined;
  const secondId = second.state === "known" ? second.team.id : undefined;
  const actionable = availability === "available" && (map.state === "lobby" || map.state === "live");
  const pendingLabel = map.mapName === undefined
    ? "Awaiting veto"
    : map.seriesMatchIndex === format
      ? "Decider"
      : "Scheduled";

  return (
    <article className={`cs2-map-row cs2-map-row--${map.state}`}>
      <div className="cs2-map-row__number">{String(map.seriesMatchIndex).padStart(2, "0")}</div>
      <div className="cs2-map-row__identity">
        <span className="nb-label">Map {map.seriesMatchIndex}</span>
        <strong>{map.mapName ?? "To be announced"}</strong>
      </div>
      <div className="cs2-map-row__status"><Badge tone={mapTone(map.state)}>{map.state}</Badge></div>
      {map.state !== "pending" && (
        <div className="cs2-map-row__score">
          <span>{participantName(first)} {mapScore(map, firstId)}</span>
          <i>:</i>
          <span>{mapScore(map, secondId)} {participantName(second)}</span>
        </div>
      )}
      {actionable ? (
        <Link className={`nb-btn ${map.state === "lobby" ? "nb-btn--survive" : "nb-btn--primary"}`} to={`/cs2/arena/${map.arena.id}`}>
          {map.state === "lobby" ? "Join map" : "Enter live"} →
        </Link>
      ) : (
        <span className="cs2-map-row__meta">
          {availability === "soon" ? "Soon" : map.state === "pending" ? pendingLabel : map.state === "finished" ? "Final" : "Closed"}
        </span>
      )}
    </article>
  );
}

export function Cs2SeriesScreen() {
  const { seriesId = "" } = useParams();
  const [result, retry] = useCs2Series(seriesId);

  if (result.state === "loading") {
    return <div className="nb-container"><Loading label="Loading series desk…" /></div>;
  }

  if (result.state === "error") {
    return (
      <div className="nb-container">
        <div className="cs2-state cs2-state--error">
          <span className="nb-label">Series unavailable</span>
          <h1>This matchup is off the board.</h1>
          <div className="cs2-state__actions">
            <button className="nb-btn nb-btn--primary" type="button" onClick={retry}>Try again</button>
            <Link className="nb-btn nb-btn--plain" to="/">All series</Link>
          </div>
        </div>
      </div>
    );
  }

  const series = result.value;
  const [first, second] = series.participants;

  return (
    <div className="nb-container cs2-series">
      <Link className="cs2-back" to="/">← All CS2 series</Link>
      <section className="cs2-match-hero">
        <div className="cs2-match-hero__event">
          <TeamLogo name={series.competition.name} {...(series.competition.logoUrl ? { src: series.competition.logoUrl } : {})} />
          <div><span className="nb-label">{series.competition.name}</span><strong>Best of {series.format}</strong></div>
          <Badge tone={series.lifecycle === "live" ? "live" : "neutral"}>{series.lifecycle}</Badge>
          {series.availability === "soon" && <span className="cs2-soon-label cs2-soon-label--detail">[SOON]</span>}
        </div>
        <div className="cs2-match-hero__versus">
          {[first, second].map((participant, index) => (
            <div className={`cs2-match-hero__team${index === 1 ? " cs2-match-hero__team--right" : ""}`} key={participant.displayOrder}>
              <TeamLogo
                name={participantName(participant)}
                {...(participant.state === "known" && participant.team.logoUrl ? { src: participant.team.logoUrl } : {})}
              />
              <span>{participantName(participant)}</span>
              <strong>{participant.seriesScore ?? 0}</strong>
            </div>
          ))}
          <span className="cs2-match-hero__divider">:</span>
        </div>
      </section>

      <section className="cs2-catalog__section">
        <div className="cs2-section-heading"><h2>Maps</h2></div>
        <div className="cs2-map-list">
          {series.maps.map((map) => (
            <MapRow
              key={map.seriesMatchIndex}
              map={map}
              participants={series.participants}
              format={series.format}
              availability={series.availability}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
