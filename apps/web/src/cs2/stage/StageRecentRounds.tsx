import { useLayoutEffect, useRef, useState } from "react";
import type { Cs2ArenaView } from "../cs2View.js";
import { cs2FeedForView } from "../live/cs2Feed.js";

export function StageRecentRounds({ view, connected, onShowFeed }: {
  view: Cs2ArenaView;
  connected: boolean;
  onShowFeed: () => void;
}) {
  const results = cs2FeedForView(view).flatMap((item) => {
    if (item.kind !== "result") return [];
    const history = view.rounds.find((candidate) => item.id === `result-${candidate.id}`);
    return history?.status === "settled" ? [{ id: item.id, roundId: history.id, roundNumber: history.roundNumber, outcome: item.outcome }] : [];
  });
  const showRecent = connected && view.myStatus !== undefined && results.length > 0;
  const recentRef = useRef<HTMLDivElement>(null);
  const [recentCount, setRecentCount] = useState(1);
  useLayoutEffect(() => {
    const element = recentRef.current;
    if (!element) return;
    const measure = () => setRecentCount(Math.max(0, Math.floor((element.clientWidth + 6) / 42)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showRecent]);

  if (!showRecent) return null;

  return (
    <div className="cs2-stage__recent-strip">
      <span className="cs2-stage__recent-label">Recent rounds</span>
      <div className="cs2-stage__recent" ref={recentRef} aria-label="Recent results">
        {results.slice(0, recentCount).map((result) => <button type="button" key={result.id} data-round-id={result.roundId} className={`cs2-stage__result-chip cs2-stage__result-chip--${result.outcome}`} onClick={onShowFeed} aria-label={`Round ${result.roundNumber}: ${result.outcome}. Open feed`}>{result.roundNumber}</button>)}
      </div>
    </div>
  );
}
