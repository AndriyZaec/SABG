import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { Loading } from "../ui/Loading.js";
import { fetchPlayerLeaderboard, fetchPlayerLeaderboardMe } from "./api/cs2Client.js";
import { playerLeaderboardView, type PlayerBoardRow, type PlayerLeaderboardView } from "./playerLeaderboard.js";
import { TeamLogo } from "./TeamLogo.js";

type LoadState =
  | { state: "loading" }
  | { state: "ready"; view: PlayerLeaderboardView }
  | { state: "error" };

function Row({ row }: { row: PlayerBoardRow }) {
  return (
    <li className={`nb-board__row${row.you ? " nb-board__row--you" : ""}`}>
      <span className="nb-board__rank">{row.rank}</span>
      <span className="nb-board__name">{row.username}</span>
      <span className="cs2-leaderboard__meta">{row.wins} W · {row.arenasPlayed} {row.arenasPlayed === 1 ? "arena" : "arenas"}</span>
      <span className="nb-board__score">{row.points}</span>
    </li>
  );
}

/** Public cross-arena leaderboard of the current scope; reached by direct link only. */
export function Cs2PlayerLeaderboardScreen() {
  const { token } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    let active = true;
    // Keep a shown board while it re-reads after sign-in; only a retry from the error screen shows loading.
    setResult((current) => current.state === "error" ? { state: "loading" } : current);
    // A failed own-row read only drops the highlight; the board itself still shows.
    const me = token ? fetchPlayerLeaderboardMe().then(({ entry }) => entry).catch(() => null) : Promise.resolve(null);
    void Promise.all([fetchPlayerLeaderboard(), me])
      .then(([response, entry]) => {
        if (active) setResult({ state: "ready", view: playerLeaderboardView(response, entry) });
      })
      .catch(() => {
        if (active) setResult({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [attempt, token]);

  if (result.state === "loading") {
    return <div className="nb-container"><Loading label="Loading leaderboard…" /></div>;
  }

  if (result.state === "error") {
    return (
      <div className="nb-container">
        <div className="cs2-state cs2-state--error">
          <span className="nb-label">Leaderboard unavailable</span>
          <h1>The standings could not be loaded.</h1>
          <div className="cs2-state__actions">
            <button className="nb-btn nb-btn--primary" type="button" onClick={() => setAttempt((current) => current + 1)}>Try again</button>
            <Link className="nb-btn nb-btn--plain" to="/">All series</Link>
          </div>
        </div>
      </div>
    );
  }

  const { view } = result;
  if (view.kind === "coming_soon") {
    return (
      <div className="nb-container">
        <div className="cs2-state">
          <span className="nb-label">Leaderboard</span>
          <h1>Leaderboard coming soon.</h1>
          <p>Play CS2 arenas now: your results will count once the leaderboard opens.</p>
          <div className="cs2-state__actions">
            <Link className="nb-btn nb-btn--primary" to="/">All series</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nb-container cs2-leaderboard">
      <section className="cs2-catalog__section">
        <div className="cs2-section-heading">
          <h1>{view.scopeName}</h1>
          {view.computedAt !== undefined && (
            <span>Updated {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(view.computedAt))}</span>
          )}
        </div>
        {view.competitions.length > 0 && (
          <ul className="cs2-leaderboard__competitions">
            {view.competitions.map((competition, index) => (
              <li key={`${competition.name}-${index}`}>
                <TeamLogo name={competition.name} fallback="trophy" {...(competition.logoUrl ? { src: competition.logoUrl } : {})} />
                <span>{competition.shortName ?? competition.name}</span>
              </li>
            ))}
          </ul>
        )}
        {view.rows.length === 0 ? (
          <p className="cs2-leaderboard__empty">No results yet. Standings appear after the first counted arena finishes.</p>
        ) : (
          <ol className="nb-board">
            {view.rows.map((row) => <Row key={row.userId} row={row} />)}
          </ol>
        )}
        {view.pinned !== undefined && (
          <ol className="nb-board cs2-leaderboard__pinned" aria-label="Your position">
            <Row row={view.pinned} />
          </ol>
        )}
      </section>
    </div>
  );
}
