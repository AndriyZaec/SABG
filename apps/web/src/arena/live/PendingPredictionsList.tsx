import type { PendingPrediction } from "@arena/contracts";
import { Panel } from "../../ui/Panel.js";
import { Badge } from "../../ui/Badge.js";

/** `windowStartMinute`/`windowEndMinute` (soccer) vs `roundNumber` (CS2) are both optional on
 *  `PendingPrediction` — pick whichever pair is present. */
function subtitleFor(p: PendingPrediction): string | null {
  if (p.windowStartMinute !== undefined && p.windowEndMinute !== undefined) {
    return `${p.windowStartMinute}:00–${p.windowEndMinute}:00`;
  }
  if (p.roundNumber !== undefined) return `Round ${p.roundNumber}`;
  return null;
}

/** Rounds the player answered that have locked but not yet settled — the current round (already
 *  shown in full by PredictionCard/Cs2RoundCard) is excluded by the caller. Shared between
 *  soccer and CS2. */
export function PendingPredictionsList({ predictions }: { predictions: PendingPrediction[] }) {
  if (predictions.length === 0) return null;

  return (
    <Panel title="Awaiting results" accent="yellow">
      <ul className="nb-feed">
        {predictions.map((p) => (
          <li key={p.roundId} className="nb-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0 }}>{p.question}</p>
              <span className="nb-label">{subtitleFor(p)}</span>
            </div>
            <Badge tone="neutral">{p.answer.toUpperCase()}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
