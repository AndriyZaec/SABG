import type { ArenaView } from "../arenaView.js";
import { PERIOD_LABEL } from "../arenaView.js";
import { Badge } from "../../ui/Badge.js";

/** Scoreboard + match clock + survivor counter. */
export function MatchHeader({ view }: { view: ArenaView }) {
  const live = view.period === "first_half" || view.period === "second_half";

  return (
    <div className="nb-rise">
      <div className="nb-scoreboard">
        <div className="nb-scoreboard__team">
          <span className="nb-teamname">{view.home}</span>
        </div>
        <div className="nb-scoreboard__score">
          <span>{view.score.home}</span>
          <span style={{ opacity: 0.5 }}>:</span>
          <span>{view.score.away}</span>
        </div>
        <div className="nb-scoreboard__team nb-scoreboard__team--away">
          <span className="nb-teamname">{view.away}</span>
        </div>
      </div>

      <div className="nb-statusbar">
        {live ? (
          <Badge tone="live">{`Live · ${view.minute}'`}</Badge>
        ) : (
          <Badge tone="neutral">{`${view.minute}'`}</Badge>
        )}
        <span className="nb-label">{PERIOD_LABEL[view.period]}</span>
        <span className="nb-survivors">
          Survivors {view.survivors}/{view.totalPlayers}
        </span>
      </div>
    </div>
  );
}
