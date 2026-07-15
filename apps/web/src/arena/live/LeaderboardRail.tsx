import type { LeaderRow } from "../arenaView.js";
import { Panel } from "../../ui/Panel.js";
import { Badge } from "../../ui/Badge.js";

/** Ranked survivors/eliminated list. */
export function LeaderboardRail({ entries }: { entries: LeaderRow[] }) {
  return (
    <Panel title="Survivors" accent="green">
      <ol className="nb-board">
        {entries.map((r, i) => (
          <li
            key={`${r.name}-${i}`}
            className={[
              "nb-board__row",
              r.you ? "nb-board__row--you" : "",
              r.status === "eliminated" ? "nb-board__row--eliminated" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="nb-board__rank">{r.rank}</span>
            <span className="nb-board__name">{r.name}</span>
            {r.status === "eliminated" ? (
              <Badge tone="eliminated">Out</Badge>
            ) : (
              <span className="nb-board__score">{r.score}</span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
