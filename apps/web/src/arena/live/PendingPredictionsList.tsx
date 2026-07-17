import type { PendingPrediction } from "@arena/contracts";
import { Panel } from "../../ui/Panel.js";
import { Badge } from "../../ui/Badge.js";

/** Rounds the player answered that have locked but not yet settled — the current round (already
 *  shown in full by PredictionCard) is excluded by the caller. */
export function PendingPredictionsList({ predictions }: { predictions: PendingPrediction[] }) {
  if (predictions.length === 0) return null;

  return (
    <Panel title="Awaiting results" accent="yellow">
      <ul className="nb-feed">
        {predictions.map((p) => (
          <li key={p.roundId} className="nb-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0 }}>{p.question}</p>
              <span className="nb-label">
                {p.windowStartMinute}:00–{p.windowEndMinute}:00
              </span>
            </div>
            <Badge tone="neutral">{p.answer.toUpperCase()}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
