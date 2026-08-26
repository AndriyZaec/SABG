import { Link } from "react-router-dom";
import { useCs2BackendArena } from "./useCs2BackendArena.js";
import { Cs2EntryCard } from "./Cs2EntryCard.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";

export function Cs2LobbyScreen() {
  const { arena, match, loading } = useCs2BackendArena();

  if (loading) {
    return (
      <div className="nb-container">
        <Loading label="Looking for a live CS2 series…" />
      </div>
    );
  }

  return (
    <div className="nb-container" style={{ display: "grid", gap: 22 }}>
      <Panel title="CS2" accent="blue">
        {arena && match ? (
          <>
            <p style={{ marginBottom: 14 }}>
              {match.teamScores[0].name} vs {match.teamScores[1].name}
            </p>
            <Cs2EntryCard />
            <Link
              to={`/cs2/arena/${arena.id}`}
              className="nb-btn nb-btn--survive nb-btn--lg nb-btn--block nb-rise"
              style={{ marginTop: 14 }}
            >
              Enter live arena →
            </Link>
          </>
        ) : (
          <p className="nb-label">No CS2 series live right now.</p>
        )}
      </Panel>
    </div>
  );
}
