import type { ClassicZoneHud } from "./classicZone.js";
import type { LeaderRow } from "./cs2View.js";

/** Rows shown before the rest collapse; the viewer's row is always shown on top of these. */
export const SURVIVORS_VISIBLE = 8;

export type BoardEntry = { kind: "row"; row: LeaderRow } | { kind: "more"; count: number };

export type SurvivorsBoard =
  | { kind: "list"; entries: BoardEntry[] }
  | {
      kind: "zone";
      zone: number;
      nextZone: number;
      /** Nobody sits between the lines: draw one red line with both labels. */
      merged: boolean;
      safe: BoardEntry[];
      risk: BoardEntry[];
      out: BoardEntry[];
    }
  | { kind: "final_circle"; left: number; finalists: BoardEntry[]; out: BoardEntry[] };

/** Keeps the visible rows in order and folds each run of hidden ones into a "N more" entry. */
function collapse(rows: readonly LeaderRow[], visible: ReadonlySet<LeaderRow>): BoardEntry[] {
  const entries: BoardEntry[] = [];
  let hidden = 0;
  for (const row of rows) {
    if (!visible.has(row)) {
      hidden++;
      continue;
    }
    if (hidden > 0) entries.push({ kind: "more", count: hidden });
    hidden = 0;
    entries.push({ kind: "row", row });
  }
  if (hidden > 0) entries.push({ kind: "more", count: hidden });
  return entries;
}

/**
 * Lays out the Survivors panel from the server-ranked rows. Zone lines need the classic zone readout;
 * without one (hardcore, finished, released runtime) it is a plain limited list.
 */
export function survivorsBoard(rows: readonly LeaderRow[], zone: ClassicZoneHud | undefined): SurvivorsBoard {
  const visible = new Set(rows.filter((row, i) => i < SURVIVORS_VISIBLE || row.you));
  if (zone === undefined || rows.length === 0) return { kind: "list", entries: collapse(rows, visible) };

  const active = rows.filter((row) => row.status !== "eliminated");
  const out = rows.filter((row) => row.status === "eliminated");
  if (zone.stage === "final_circle") {
    return { kind: "final_circle", left: active.length, finalists: collapse(active, visible), out: collapse(out, visible) };
  }

  const safe = active.filter((row) => row.score >= zone.nextZone);
  const risk = active.filter((row) => row.score < zone.nextZone);
  return {
    kind: "zone",
    zone: zone.zoneNow,
    nextZone: zone.nextZone,
    merged: zone.zoneNow === zone.nextZone || risk.length === 0,
    safe: collapse(safe, visible),
    risk: collapse(risk, visible),
    out: collapse(out, visible),
  };
}
