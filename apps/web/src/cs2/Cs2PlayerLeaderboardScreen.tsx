import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { STEAM_TRADE_URL_PATTERN, type PlayerLeaderboardPrize, type PlayerLeaderboardPrizeClaim } from "@arena/contracts";
import { useAuth } from "../auth/AuthContext.js";
import { Loading } from "../ui/Loading.js";
import { Cs2ApiError, fetchPlayerLeaderboard, fetchPlayerLeaderboardMe, submitPrizeTradeUrl } from "./api/cs2Client.js";
import { playerLeaderboardView, type PlayerBoardRow, type PlayerLeaderboardView } from "./playerLeaderboard.js";
import { TeamLogo } from "./TeamLogo.js";

type LoadState =
  | { state: "loading" }
  | { state: "ready"; view: PlayerLeaderboardView }
  | { state: "error" };

function Row({ row }: { row: PlayerBoardRow }) {
  // A disqualified row's rank is virtual, so it never gets the leader's trophy.
  const first = row.rank === 1 && !row.disqualified;
  return (
    <li className={`nb-board__row${row.you ? " nb-board__row--you" : ""}${first ? " cs2-leaderboard__row--first" : ""}${row.disqualified ? " cs2-leaderboard__row--disqualified" : ""}`}>
      {first ? (
        <span className="nb-board__rank">
          <svg className="cs2-leaderboard__trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Rank 1">
            <path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v7M8 21h8" />
          </svg>
        </span>
      ) : (
        <span className="nb-board__rank" {...(row.disqualified ? { "aria-label": `Virtual rank ${row.rank}`, title: "Virtual rank: where these points would place" } : {})}>{row.rank}</span>
      )}
      <span className="nb-board__name">{row.username}</span>
      {row.disqualified
        ? <span className="cs2-leaderboard__disqualified">Disqualified</span>
        : <span className="cs2-leaderboard__meta">{row.wins} W · {row.arenasPlayed} {row.arenasPlayed === 1 ? "arena" : "arenas"}</span>}
      {row.prize !== undefined && (
        <img className="cs2-leaderboard__prize-badge" src={row.prize.imageUrl} referrerPolicy="no-referrer" alt={`Prize for place ${row.prize.place}`} title={`Prize for place ${row.prize.place}`} loading="lazy" />
      )}
      <span className="nb-board__score">{row.points}</span>
    </li>
  );
}

function Prizes({ prizes }: { prizes: PlayerLeaderboardPrize[] }) {
  return (
    <div className="cs2-leaderboard__group">
      <span className="nb-label">Prizes</span>
      <ul className="cs2-leaderboard__prizes">
        {prizes.map((prize) => (
          <li key={prize.place}>
            <img src={prize.imageUrl} referrerPolicy="no-referrer" alt={`Prize for place ${prize.place}`} loading="lazy" />
            <span>#{prize.place}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TRADE_URL_ERRORS: Record<number, string> = {
  400: "That isn't a Steam trade offer link.",
  404: "There is no prize to claim on this leaderboard any more.",
  409: "Your prize has already been sent, so the link can no longer change.",
};

/** The winner's prize and their Steam trade URL, which they can change until the prize is sent. */
function WinnerBanner({ claim, onClaimChange, onStale }: {
  claim: PlayerLeaderboardPrizeClaim;
  onClaimChange: (claim: PlayerLeaderboardPrizeClaim) => void;
  /** The server knows a newer state of the prize: read the board again. */
  onStale: () => void;
}) {
  const [tradeUrl, setTradeUrl] = useState(claim.tradeUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string }>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = tradeUrl.trim();
    if (!STEAM_TRADE_URL_PATTERN.test(value)) {
      setMessage({ tone: "error", text: TRADE_URL_ERRORS[400]! });
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      const { prize } = await submitPrizeTradeUrl(value);
      onClaimChange(prize);
      setMessage({ tone: "success", text: "Trade link saved. You can change it until the prize is sent." });
    } catch (error) {
      const status = error instanceof Cs2ApiError ? error.status : undefined;
      setMessage({ tone: "error", text: (status !== undefined ? TRADE_URL_ERRORS[status] : undefined) ?? "The trade link could not be saved. Try again." });
      if (status === 404 || status === 409) onStale();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cs2-leaderboard__winner" aria-label="Your prize">
      <img src={claim.imageUrl} referrerPolicy="no-referrer" alt={`Prize for place ${claim.place}`} />
      <div className="cs2-leaderboard__winner-body">
        <span className="nb-label">You won place {claim.place}</span>
        {claim.sent ? (
          <p><strong>Sent.</strong> Your prize went out as a Steam trade offer.</p>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="cs2-trade-url">Your Steam trade offer link, so we can send the prize</label>
            <input
              id="cs2-trade-url"
              className="nb-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={tradeUrl}
              onChange={(event) => setTradeUrl(event.target.value)}
              placeholder="https://steamcommunity.com/tradeoffer/new/?partner=…&token=…"
            />
            <button className="nb-btn nb-btn--primary" type="submit" disabled={saving || tradeUrl.trim() === ""}>
              {saving ? "Saving…" : claim.tradeUrl !== undefined ? "Update link" : "Send link"}
            </button>
          </form>
        )}
        {message !== undefined && <p className={`cs2-leaderboard__winner-message cs2-leaderboard__winner-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
      </div>
    </section>
  );
}

/** Public cross-arena leaderboard of the current or last finalized scope; reached by direct link only. */
export function Cs2PlayerLeaderboardScreen() {
  const { token } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    let active = true;
    // Keep a shown board while it re-reads after sign-in; only a retry from the error screen shows loading.
    setResult((current) => current.state === "error" ? { state: "loading" } : current);
    // A failed own-row read only drops the highlight; the board itself still shows.
    const me = token ? fetchPlayerLeaderboardMe().catch(() => null) : Promise.resolve(null);
    void Promise.all([fetchPlayerLeaderboard(), me])
      .then(([response, mine]) => {
        if (active) setResult({ state: "ready", view: playerLeaderboardView(response, mine) });
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
  const reload = () => setAttempt((current) => current + 1);
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
          <h1>{view.scopeName}{view.finalized && <span className="cs2-leaderboard__final"> · Final results</span>}</h1>
          {view.computedAt !== undefined && (
            <span>Updated {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(view.computedAt))}</span>
          )}
        </div>
        {view.claim !== undefined && (
          <WinnerBanner
            claim={view.claim}
            onClaimChange={(claim) => setResult({ state: "ready", view: { ...view, claim } })}
            onStale={reload}
          />
        )}
        {view.competitions.length > 0 && (
          <ul className="cs2-leaderboard__competitions">
            {view.competitions.map((competition, index) => (
              <li key={`${competition.name}-${index}`} tabIndex={0}>
                <TeamLogo name={competition.name} fallback="trophy" {...(competition.logoUrl ? { src: competition.logoUrl } : {})} />
                <span className="cs2-leaderboard__competition-name">{competition.name}</span>
                <span className="cs2-leaderboard__competition-full" aria-hidden="true">
                  <TeamLogo name={competition.name} fallback="trophy" {...(competition.logoUrl ? { src: competition.logoUrl } : {})} />
                  <span>{competition.name}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {view.prizes.length > 0 && <Prizes prizes={view.prizes} />}
        {view.me !== undefined && (
          <div className="cs2-leaderboard__group">
            <span className="nb-label">Your position</span>
            <ol className="nb-board" aria-label="Your position">
              <Row row={view.me} />
            </ol>
            {view.disqualificationReason !== undefined && (
              <p className="cs2-leaderboard__reason"><strong>You are disqualified:</strong> {view.disqualificationReason} Your points still count, but you can't take a prize place.</p>
            )}
          </div>
        )}
        {view.rows.length === 0 ? (
          <p className="cs2-leaderboard__empty">No results yet. Standings appear after the first counted arena finishes.</p>
        ) : (
          <div className="cs2-leaderboard__group">
            <span className="nb-label">Standings</span>
            <ol className="nb-board" aria-label="Standings">
              {view.rows.map((row) => <Row key={row.userId} row={row} />)}
            </ol>
          </div>
        )}
        {view.pinned !== undefined && (
          <ol className="nb-board cs2-leaderboard__pinned" aria-label="Your position below the top">
            <Row row={view.pinned} />
          </ol>
        )}
      </section>
    </div>
  );
}
