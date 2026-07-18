import { Link } from "react-router-dom";
import { EntryCard } from "../arena/EntryCard.js";
import { useBackendArena } from "../arena/useBackendArena.js";
import { DEMO_VIEW, PERIOD_LABEL } from "../arena/arenaView.js";
import { Badge } from "../ui/Badge.js";

/** Seeded schedule so the lobby reads like a live tournament product (display-only for the demo).
 *  Mirrors the real bracket in db/seeds/matches.json: the featured match is the semi-final
 *  (England v Argentina), so this only lists what's left — 3rd place and the final. */
const UPCOMING = [
  { home: "France", away: "England", kickoff: "Sat · 21:00" },
  { home: "Spain", away: "Argentina", kickoff: "Sun · 19:00" },
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

  // Ticker adapts to match state: lobby info before kickoff, live stats during. Real arena numbers
  // when the backend is up, demo fallbacks otherwise.
  const sol = (lamports: number) => Number((lamports / 1_000_000_000).toFixed(3));
  const entrySol = arena ? sol(arena.entryFeeLamports) : 0.1;
  const poolSol = arena ? sol(arena.prizePoolLamports) : 0.8;
  const joined = arena?.activePlayersCount ?? DEMO_VIEW.totalPlayers;
  const kickoff = match
    ? new Date(match.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "21:00";

  const ticker = live
    ? [
        `● Live ${hero.minute}'`,
        `${hero.home} ${hero.score.home}–${hero.score.away} ${hero.away}`,
        `${survivors} survivors left`,
        `Pool ${poolSol} SOL`,
        "One Yes/No every 5 minutes",
        "Last survivor takes the pool",
      ]
    : [
        "● Lobby open",
        `${hero.home} vs ${hero.away}`,
        `Kickoff ${kickoff}`,
        `Entry ${entrySol} SOL · Pool ${poolSol} SOL`,
        `${joined} players in`,
        "One Yes/No every 5 minutes",
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
        {/* entry / join docked into the same card */}
        <div className="nb-hero__foot">
          <EntryCard />
        </div>
      </section>

      <Link to={`/arena/${arenaId}`} className="nb-btn nb-btn--survive nb-btn--lg nb-btn--block nb-rise">
        Enter live arena →
      </Link>

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
    </div>
  );
}
