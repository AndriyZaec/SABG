import { Link } from "react-router-dom";
import { EntryCard } from "../arena/EntryCard.js";
import { useBackendArena } from "../arena/useBackendArena.js";

const STEPS = ["Buy in", "Answer Yes / No", "Survive", "Take the pool"];

export function LobbyScreen() {
  const { arena } = useBackendArena();
  const arenaId = arena?.id ?? "demo";

  return (
    <div className="nb-container" style={{ display: "grid", gap: 26 }}>
      <section className="nb-rise">
        <h1>
          Read the game.
          <br />
          Survive the match.
        </h1>
        <p className="nb-mono" style={{ maxWidth: 580, marginTop: 14 }}>
          A live survival game for football. Every 5 minutes you get one context-aware Yes/No call.
          Get it wrong — or miss it — and you&apos;re out. The last survivor takes the prize pool.
        </p>
        <div className="nb-row" style={{ marginTop: 18 }}>
          {STEPS.map((s, i) => (
            <span key={s} className="nb-badge nb-badge--neutral">
              {i + 1} · {s}
            </span>
          ))}
        </div>
      </section>

      <div style={{ maxWidth: 460 }}>
        <EntryCard />
      </div>

      <div className="nb-row">
        <Link to={`/arena/${arenaId}`} className="nb-btn nb-btn--plain">
          Enter live arena →
        </Link>
        <Link to={`/arena/${arenaId}/payout`} className="nb-btn nb-btn--plain">
          Winner / Payout
        </Link>
      </div>
    </div>
  );
}
