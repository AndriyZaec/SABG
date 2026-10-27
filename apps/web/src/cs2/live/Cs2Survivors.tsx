import type { ReactNode } from "react";
import type { LeaderRow } from "../cs2View.js";
import type { BoardEntry, SurvivorsBoard } from "../survivorsBoard.js";
import { Badge } from "../../ui/Badge.js";

function Row({ row }: { row: LeaderRow }) {
  const className = [
    "nb-board__row",
    row.you ? "nb-board__row--you" : "",
    row.status === "eliminated" ? "nb-board__row--eliminated" : "",
  ].filter(Boolean).join(" ");
  return (
    <li className={className}>
      <span className="nb-board__rank">{row.rank}</span>
      <span className="nb-board__name">{row.name}</span>
      {row.status === "eliminated" ? <Badge tone="eliminated">Out</Badge> : <span className="nb-board__score">{row.score}</span>}
    </li>
  );
}

function Entries({ entries }: { entries: BoardEntry[] }) {
  return (
    <>
      {entries.map((entry, i) =>
        entry.kind === "row"
          ? <Row key={`${entry.row.rank}-${entry.row.name}`} row={entry.row} />
          : <li key={`more-${i}`} className="cs2-board__more">{entry.count} more</li>,
      )}
    </>
  );
}

function Band({ entries, tone }: { entries: BoardEntry[]; tone?: "risk" | "out" }) {
  return (
    <ol className={`cs2-board__band${tone ? ` cs2-board__band--${tone}` : ""}${entries.length === 0 ? " cs2-board__band--empty" : ""}`}>
      <Entries entries={entries} />
    </ol>
  );
}

function Line({ tone, children }: { tone: "next" | "zone"; children: ReactNode }) {
  return (
    <div className={`cs2-board__line cs2-board__line--${tone}`}>
      <span className="cs2-board__tag">{children}</span>
    </div>
  );
}

/** Survivors panel: top players and you, with the classic zone drawn as lines and bands. */
export function Cs2Survivors({ board, active, total }: { board: SurvivorsBoard; active: number; total: number }) {
  const final = board.kind === "final_circle";
  return (
    <section className={`nb-panel cs2-board${final ? " cs2-board--final" : ""}`}>
      <header className={`nb-panel__bar ${final ? "cs2-board__bar--final" : "nb-bg--green"}`}>
        {final ? "Final Circle" : "Survivors"} · {active} / {total}
      </header>
      <div className="cs2-board__body">
        {board.kind === "list" && <Band entries={board.entries} />}
        {board.kind === "zone" && (
          <>
            <Band entries={board.safe} />
            {board.merged ? (
              <Line tone="zone">
                <span className="cs2-board__tag-next">Next {board.nextZone}</span>
                <span className="cs2-board__tag-zone">Zone {board.zone}</span>
              </Line>
            ) : (
              <>
                <Line tone="next">Next {board.nextZone}</Line>
                <Band entries={board.risk} tone="risk" />
                <Line tone="zone">Zone {board.zone}</Line>
              </>
            )}
            <Band entries={board.out} tone="out" />
          </>
        )}
        {board.kind === "final_circle" && (
          <>
            <div className="cs2-board__fc">
              <div className="cs2-board__ring"><b>{board.left}</b></div>
              <div>
                <div className="cs2-board__fc-title">{board.left} left</div>
                <div className="cs2-board__fc-sub">One miss and you&apos;re out</div>
              </div>
            </div>
            <Band entries={board.finalists} />
            {board.out.length > 0 && (
              <div className="cs2-board__fc-out">
                <span className="nb-label">Out</span>
                <Band entries={board.out} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
