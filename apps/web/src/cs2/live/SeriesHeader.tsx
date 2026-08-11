import type { Cs2ArenaView } from "../cs2View.js";
import { Badge } from "../../ui/Badge.js";

/** CS2's analog of arena/live/MatchHeader.tsx — no score/clock/period (CS2 has no soccer-style
 *  match-state stream), just team names (once known), the current round number, and survivors. */
export function SeriesHeader({ view }: { view: Cs2ArenaView }) {
  const teams = view.homeTeam && view.awayTeam ? `${view.homeTeam} vs ${view.awayTeam}` : "Waiting for teams…";

  return (
    <div className="nb-rise">
      <div className="nb-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="nb-teamname">{teams}</span>
        {view.seriesFormat !== undefined && <span className="nb-label">Best of {view.seriesFormat}</span>}
      </div>

      <div className="nb-statusbar">
        {view.round ? (
          <Badge tone="live">{`Round ${view.round.roundNumber}`}</Badge>
        ) : (
          <Badge tone="neutral">Waiting for round…</Badge>
        )}
        <span className="nb-survivors">
          Survivors {view.survivors}/{view.totalPlayers}
        </span>
      </div>
    </div>
  );
}
