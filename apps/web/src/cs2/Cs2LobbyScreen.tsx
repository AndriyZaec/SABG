import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPrimaryCs2Arena, type PrimaryCs2Arena } from "./api/cs2Client.js";
import { Loading } from "../ui/Loading.js";
import { Panel } from "../ui/Panel.js";

// CS2's analog of screens/LobbyScreen.tsx. Deliberately minimal — no entry/buy-in card (CS2
// arenas aren't provisioned on-chain yet, so there's nothing to join), no score/clock ticker
// (CS2 has no such stream), no mocked "upcoming matches" list (no CS2 equivalent exists to mock).
export function Cs2LobbyScreen() {
  const [primary, setPrimary] = useState<PrimaryCs2Arena | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchPrimaryCs2Arena()
      .then((p) => active && setPrimary(p))
      .catch(() => active && setPrimary(null));
    return () => {
      active = false;
    };
  }, []);

  if (primary === undefined) {
    return (
      <div className="nb-container">
        <Loading label="Looking for a live CS2 series…" />
      </div>
    );
  }

  return (
    <div className="nb-container" style={{ display: "grid", gap: 22 }}>
      <Panel title="CS2" accent="blue">
        {primary ? (
          <>
            <p style={{ marginBottom: 14 }}>
              {primary.match.homeTeam} vs {primary.match.awayTeam}
            </p>
            <Link to={`/cs2/arena/${primary.arena.id}`} className="nb-btn nb-btn--survive nb-btn--lg nb-btn--block nb-rise">
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
