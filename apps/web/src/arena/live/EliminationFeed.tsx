import type { FeedItem } from "../arenaView.js";
import { Panel } from "../../ui/Panel.js";

/** Running ticker of eliminations, survivals and round events (newest first). */
export function EliminationFeed({ feed }: { feed: FeedItem[] }) {
  return (
    <Panel title="Match feed" accent="pink">
      {feed.length === 0 ? (
        <p className="nb-label">No events yet.</p>
      ) : (
        <ul className="nb-feed">
          {feed.map((f) => (
            <li key={f.id} className={`nb-feed__item nb-feed__item--${f.kind}`}>
              <span className="nb-feed__marker" aria-hidden />
              <span>{f.text}</span>
              {f.minute != null && <span className="nb-feed__min">{f.minute}&apos;</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
