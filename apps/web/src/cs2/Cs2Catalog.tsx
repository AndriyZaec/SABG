import type { Cs2SeriesParticipant, Cs2SeriesSummary } from "@arena/contracts";
import { Link } from "react-router-dom";
import { Badge } from "../ui/Badge.js";
import { NotifyMeToggle } from "./NotifyMeToggle.js";
import { TeamLogo } from "./TeamLogo.js";
import { arenaForecastLabel } from "./arenaForecastLabel.js";

const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const eventTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const scheduleDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });

function participantName(participant: Cs2SeriesParticipant): string {
  return participant.state === "known" ? (participant.team.shortName ?? participant.team.name) : "TBD";
}

function ParticipantLogo({ participant }: { participant: Cs2SeriesParticipant }) {
  return (
    <TeamLogo
      name={participantName(participant)}
      {...(participant.state === "known" && participant.team.logoUrl ? { src: participant.team.logoUrl } : {})}
    />
  );
}

function UpcomingQueueItem({ item, following }: { item: Cs2SeriesSummary; following: boolean }) {
  const className = `cs2-broadcast__queue-item${item.arena === "expected" ? " cs2-broadcast__queue-item--expected" : ""}${item.arena !== "running" ? " cs2-broadcast__queue-item--soon" : ""}`;
  const content = (
    <>
      <div className="cs2-broadcast__queue-time-col">
        <NotifyMeToggle seriesId={item.id} initiallyFollowing={following} />
        <time className="cs2-broadcast__queue-time">{eventTime.format(new Date(item.scheduledStartTime))}</time>
      </div>
      <div className="cs2-broadcast__queue-body">
        <div className="cs2-broadcast__queue-teams">
          {item.participants.map((participant) => (
            <span key={participant.displayOrder}>
              <ParticipantLogo participant={participant} />
              <strong>{participantName(participant)}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="cs2-broadcast__queue-tags">
        <b>Bo{item.format}</b>
        <i>{item.arena === "running" ? "→" : "·"}</i>
      </div>
      {item.arena !== "running" && <span className="cs2-soon-label">[SOON]</span>}
    </>
  );
  return item.arena === "running"
    ? <Link className={className} to={`/cs2/series/${item.id}`}>{content}</Link>
    : <div aria-disabled="true" className={className}>{content}</div>;
}

export function Cs2Catalog({ series, followedIds }: { series: Cs2SeriesSummary[]; followedIds: string[] }) {
  const liveSeries = series.filter((item) => item.lifecycle === "live");
  const upcoming = series
    .filter((item) => item.lifecycle === "upcoming")
    .sort((a, b) => Date.parse(a.scheduledStartTime) - Date.parse(b.scheduledStartTime));
  const nextSeries = upcoming.find((item) => item.arena === "expected") ?? upcoming[0];
  const competition = series[0]!.competition;
  const upcomingByDay = new Map<string, Cs2SeriesSummary[]>();
  for (const item of upcoming) {
    const day = scheduleDay.format(new Date(item.scheduledStartTime));
    upcomingByDay.set(day, [...(upcomingByDay.get(day) ?? []), item]);
  }

  const layoutState = liveSeries.length > 1 ? "multi-live" : liveSeries.length === 1 ? "single-live" : "no-live";

  return (
    <div className="nb-container cs2-broadcast">
      <header className="cs2-broadcast__mast">
        <TeamLogo name={competition.name} {...(competition.logoUrl ? { src: competition.logoUrl } : {})} />
        <div><span className="nb-label">Event</span><h1>{competition.name}</h1></div>
        <div className="cs2-broadcast__signal">
          <Badge tone={liveSeries.length > 0 ? "live" : "neutral"}>{liveSeries.length > 0 ? "Live event" : "Off air"}</Badge>
          <span>{liveSeries.length} live · {upcoming.length} upcoming</span>
        </div>
      </header>

      <div className={`cs2-broadcast__layout cs2-broadcast__layout--${layoutState}`}>
        <section className="cs2-broadcast__feature">
          <div className="cs2-broadcast__feature-top">
            <span>Live now</span>
            <span>{liveSeries.length} Series on air</span>
          </div>
          <div className="cs2-broadcast__live-grid">
            {liveSeries.map((item) => (
              <article className={`cs2-broadcast__live-card${item.arena !== "running" ? " cs2-broadcast__live-card--soon" : ""}`} key={item.id}>
                <div className="cs2-broadcast__live-meta">
                  <span>Best of {item.format}</span>
                  <time>{eventTime.format(new Date(item.scheduledStartTime))}</time>
                </div>
                <div className="cs2-broadcast__live-teams">
                  {item.participants.map((participant, index) => (
                    <div className={index === 1 ? "cs2-broadcast__live-team--right" : ""} key={participant.displayOrder}>
                      <ParticipantLogo participant={participant} />
                      <strong>{participantName(participant)}</strong>
                      <b>{participant.seriesScore ?? 0}</b>
                    </div>
                  ))}
                  <span className="cs2-broadcast__live-vs cs2-versus-badge">VS</span>
                </div>
                {item.arena === "running"
                  ? <Link className="nb-btn nb-btn--survive nb-btn--block" to={`/cs2/series/${item.id}`}>Open live series →</Link>
                  : <span aria-disabled="true" className="nb-btn nb-btn--plain nb-btn--block">{arenaForecastLabel[item.arena] ?? "Series coming soon"}</span>}
              </article>
            ))}
            {liveSeries.length === 0 && (
              <div className="cs2-broadcast__no-live">
                <span>Off air</span>
                <strong>No Series live right now</strong>
                {nextSeries && (
                  <>
                    <p>
                      Next: {participantName(nextSeries.participants[0])} vs {participantName(nextSeries.participants[1])}
                      {" · "}{fullDate.format(new Date(nextSeries.scheduledStartTime))}
                    </p>
                    {nextSeries.arena === "running"
                      ? <Link className="nb-btn nb-btn--primary" to={`/cs2/series/${nextSeries.id}`}>View next series →</Link>
                      : <span aria-disabled="true" className="nb-btn nb-btn--plain">{arenaForecastLabel[nextSeries.arena] ?? "Series coming soon"}</span>}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="cs2-broadcast__queue">
          <div className="cs2-broadcast__queue-head"><span>Coming up</span><strong>{upcoming.length}</strong></div>
          <div className="cs2-broadcast__queue-scroll">
            {upcoming.length > 0
              ? [...upcomingByDay].map(([day, items]) => (
                  <section className="cs2-broadcast__queue-day" key={day}>
                    <div className="cs2-broadcast__queue-day-head"><span>{day}</span></div>
                    {items.map((item) => (
                      <UpcomingQueueItem
                        key={item.id}
                        item={item}
                        following={followedIds.includes(item.id)}
                      />
                    ))}
                  </section>
                ))
              : (
                  <div className="cs2-broadcast__queue-empty">
                    <strong>Schedule clear</strong>
                    <p>No upcoming Series have been published for this event yet.</p>
                    <span>Live Series remain available on the match board.</span>
                  </div>
                )}
          </div>
        </aside>
      </div>
    </div>
  );
}
