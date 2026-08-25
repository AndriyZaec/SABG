import type { PendingPrediction } from "@arena/contracts";
import { Panel } from "../../ui/Panel.js";
import { Badge } from "../../ui/Badge.js";

/** Soccer uses minute windows; CS2 uses round numbers. */
function subtitleFor(p: PendingPrediction): string | null {
  if (p.windowStartMinute !== undefined && p.windowEndMinute !== undefined) {
    return `${p.windowStartMinute}:00–${p.windowEndMinute}:00`;
  }
  if (p.roundNumber !== undefined) return `Round ${p.roundNumber}`;
  return null;
}

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
