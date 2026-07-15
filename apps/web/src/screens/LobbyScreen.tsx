import { Link } from "react-router-dom";
import { EntryCard } from "../arena/EntryCard.js";
import { useBackendArena } from "../arena/useBackendArena.js";
import { DEMO_VIEW, PERIOD_LABEL } from "../arena/arenaView.js";
import { Badge } from "../ui/Badge.js";

const STEPS = ["Buy in", "Answer Yes / No", "Survive", "Take the pool"];

/** Seeded schedule so the lobby reads like a live tournament product (display-only for the demo). */
const UPCOMING = [
  { home: "England", away: "France", kickoff: "Today · 21:00" },
  { home: "Spain", away: "Germany", kickoff: "Tomorrow · 18:00" },
  { home: "Portugal", away: "Netherlands", kickoff: "Sat · 20:00" },
  { home: "USA", away: "Mexico", kickoff: "Sun · 22:00" },
];

export function LobbyScreen() {
  const { arena, match } = useBackendArena();
  const arenaId = arena?.id ?? "demo";

  // Broadcast hero source: the live backend match, or the seeded demo fixture as a fallback so the
  // lobby looks like matchday even without a gateway (also the recording fallback).
  const hero = match
    ? { home: match.homeTeam, away: match.awayTeam, score: match.score, minute: match.currentMinute, period: match.period }
    : { home: DEMO_VIEW.home, away: DEMO_VIEW.away, score: DEMO_VIEW.score, minute: DEMO_VIEW.minute, period: DEMO_VIEW.period };
  const survivors = arena?.activePlayersCount ?? DEMO_VIEW.survivors;
  const live = hero.period === "first_half" || hero.period === "second_half";

  const ticker = [
    `● ${hero.home} ${hero.score.home}–${hero.score.away} ${hero.away}`,
    `${survivors} survivors left`,
    "One Yes/No every 5 minutes",
    "Miss it or call it wrong — you're out",
    "Last survivor takes the pool",
  ];

  return (
    <div className="nb-container" style={{ display: "grid", gap: 22 }}>
      {/* Matchday broadcast hero — the live match */}
      <section className="nb-hero nb-rise">
        <div className="nb-hero__strip">
          {live ? (
            <Badge tone="live">{`Live · ${hero.minute}'`}</Badge>
          ) : (
            <Badge tone="neutral">{PERIOD_LABEL[hero.period]}</Badge>
          )}
          <span className="nb-label" style={{ opacity: 0.8 }}>{PERIOD_LABEL[hero.period]}</span>
          <span className="nb-hero__survivors">{survivors} survivors</span>
        </div>
        <div className="nb-hero__vs">
          <span className="nb-hero__team">{hero.home}</span>
          <span className="nb-hero__score">
            {hero.score.home}
            <i>:</i>
            {hero.score.away}
          </span>
          <span className="nb-hero__team nb-hero__team--away">{hero.away}</span>
        </div>
      </section>

      <Link to={`/arena/${arenaId}`} className="nb-btn nb-btn--survive nb-btn--lg nb-btn--block nb-rise">
        Enter live arena →
      </Link>

      <div style={{ maxWidth: 460 }}>
        <EntryCard />
      </div>

      {/* Scrolling matchday ticker */}
      <div className="nb-ticker" aria-hidden>
        <div className="nb-ticker__track">
          {[...ticker, ...ticker].map((t, i) => (
            <span className="nb-ticker__item" key={i}>{t}</span>
          ))}
        </div>
      </div>

      {/* Upcoming matches — the schedule */}
      <section className="nb-section" style={{ marginTop: 8 }}>
        <h2>Upcoming matches</h2>
        <div className="nb-fixtures">
          {UPCOMING.map((f) => (
            <div className="nb-fixture" key={`${f.home}-${f.away}`}>
              <div className="nb-fixture__teams">
                {f.home}
                <i>vs</i>
                {f.away}
              </div>
              <div className="nb-fixture__meta">
                <span className="nb-badge nb-badge--neutral">Upcoming</span>
                <span className="nb-label">{f.kickoff}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — slim reference strip */}
      <div className="nb-row" style={{ gap: 8 }}>
        <span className="nb-label">How it works</span>
        {STEPS.map((s, i) => (
          <span key={s} className="nb-badge nb-badge--neutral">
            {i + 1} · {s}
          </span>
        ))}
      </div>

      <div className="nb-row">
        <Link to={`/arena/${arenaId}/payout`} className="nb-btn nb-btn--plain">
          Winner / Payout
        </Link>
      </div>
    </div>
  );
}
