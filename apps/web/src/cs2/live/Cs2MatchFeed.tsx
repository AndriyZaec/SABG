import type { Cs2FeedItem } from "./cs2Feed.js";
import { Panel } from "../../ui/Panel.js";

const OUTCOME_LABEL = { correct: "Correct", wrong: "Wrong", missed: "Missed" } as const;

/** CS2 match feed, newest first: a result per round plus zone, Final Circle and end-of-arena events. */
export function Cs2MatchFeed({ items }: { items: Cs2FeedItem[] }) {
  return (
    <Panel title="Match feed" accent="pink">
      {items.length === 0 ? (
        <p className="nb-label">No events yet.</p>
      ) : (
        <ul className="nb-feed">
          {items.map((item) =>
            item.kind === "result" ? (
              <li key={item.id} className={`nb-feed__item cs2-feed__result cs2-feed__result--${item.outcome}`}>
                <span className="nb-feed__marker" aria-hidden />
                <span className="cs2-feed__outcome">{OUTCOME_LABEL[item.outcome]}</span>
                {item.points !== undefined && <b className="cs2-feed__points">+{item.points}</b>}
                <span className="cs2-feed__detail">{item.detail}</span>
              </li>
            ) : (
              <li key={item.id} className={`nb-feed__item cs2-feed__item--${item.kind}`}>
                <span className="nb-feed__marker" aria-hidden />
                <span>{item.text}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}
