import { useLayoutEffect, useRef, useState } from "react";
import type { Cs2FeedItem } from "./cs2Feed.js";
import { Panel } from "../../ui/Panel.js";

const OUTCOME_LABEL = { correct: "Correct", wrong: "Wrong", missed: "Missed" } as const;

/** Items visible without scrolling; older ones scroll inside the panel. */
const VISIBLE_ITEMS = 5;

/** Fits the list to its first items, which differ in height, so the next one starts just below the fold. */
function useVisibleHeight(items: Cs2FeedItem[]) {
  const listRef = useRef<HTMLUListElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      const last = list !== null && list.children.length > VISIBLE_ITEMS ? list.children[VISIBLE_ITEMS - 1] : undefined;
      // offsetTop is relative to the list (`.cs2-feed` is positioned).
      setMaxHeight(last instanceof HTMLElement ? last.offsetTop + last.offsetHeight : undefined);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items]);
  return { listRef, maxHeight };
}

/** CS2 match feed, newest first: a result per round plus zone, Final Circle and end-of-arena events. */
export function Cs2MatchFeed({ items }: { items: Cs2FeedItem[] }) {
  const { listRef, maxHeight } = useVisibleHeight(items);
  return (
    <Panel title="Match feed" accent="pink">
      {items.length === 0 ? (
        <p className="nb-label">No events yet.</p>
      ) : (
        <ul ref={listRef} className="nb-feed cs2-feed" style={maxHeight !== undefined ? { maxHeight } : undefined}>
          {items.map((item) => {
            switch (item.kind) {
              case "result":
                return (
                  <li key={item.id} className={`nb-feed__item cs2-feed__result cs2-feed__result--${item.outcome}`}>
                    <span className="nb-feed__marker" aria-hidden />
                    <span className="cs2-feed__outcome">{OUTCOME_LABEL[item.outcome]}</span>
                    {item.points !== undefined && <b className="cs2-feed__points">+{item.points}</b>}
                    <span className="cs2-feed__detail">{item.detail}</span>
                  </li>
                );
              case "event":
                return (
                  <li key={item.id} className={`nb-feed__item cs2-feed__result cs2-feed__event--${item.tone}`}>
                    <span className="nb-feed__marker" aria-hidden />
                    <span className="cs2-feed__outcome">{item.title}</span>
                    {item.value !== undefined && <b className="cs2-feed__points">{item.value}</b>}
                    {item.detail !== undefined && <span className="cs2-feed__detail">{item.detail}</span>}
                  </li>
                );
              default:
                return (
                  <li key={item.id} className={`nb-feed__item cs2-feed__item--${item.kind}`}>
                    <span className="nb-feed__marker" aria-hidden />
                    <span>{item.text}</span>
                  </li>
                );
            }
          })}
        </ul>
      )}
    </Panel>
  );
}
