import { describe, expect, it } from "vitest";
import type { LeaderRow } from "./cs2View.js";
import { survivorsBoard, type BoardEntry } from "./survivorsBoard.js";

function rows(spec: Array<[score: number, status?: LeaderRow["status"], you?: boolean]>): LeaderRow[] {
  return spec.map(([score, status = "active", you], i) => ({ rank: i + 1, name: `p${i + 1}`, score, status, ...(you ? { you } : {}) }));
}

const names = (entries: BoardEntry[]) => entries.map((e) => (e.kind === "row" ? e.row.name : `+${e.count}`));
const zone = (zoneNow: number, nextZone: number) => ({ stage: "zone" as const, zoneNow, nextZone });

describe("survivorsBoard", () => {
  it("splits active players by the next zone and puts the eliminated below the red line", () => {
    const board = survivorsBoard(rows([[6], [5], [4], [3, "eliminated"]]), zone(4, 5));
    expect(board).toMatchObject({ kind: "zone", zone: 4, nextZone: 5, merged: false });
    if (board.kind !== "zone") throw new Error("expected zone");
    expect(names(board.safe)).toEqual(["p1", "p2"]);
    expect(names(board.risk)).toEqual(["p3"]);
    expect(names(board.out)).toEqual(["p4"]);
  });

  it("merges the lines when nobody sits between them, or when both zones are equal", () => {
    expect(survivorsBoard(rows([[6], [5], [1, "eliminated"]]), zone(4, 5))).toMatchObject({ merged: true });
    expect(survivorsBoard(rows([[2], [0]]), zone(0, 0))).toMatchObject({ merged: true });
  });

  it("shows the top 8 and the viewer outside it, folding the rest per band", () => {
    const spec: Array<[number, LeaderRow["status"]?, boolean?]> = [
      ...Array.from({ length: 10 }, () => [9] as [number]),
      [4], [4], [4, "active", true], [4],
      ...Array.from({ length: 3 }, () => [1, "eliminated"] as [number, LeaderRow["status"]]),
    ];
    const board = survivorsBoard(rows(spec), zone(4, 5));
    if (board.kind !== "zone") throw new Error("expected zone");
    expect(names(board.safe)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "+2"]);
    expect(names(board.risk)).toEqual(["+2", "p13", "+1"]);
    expect(names(board.out)).toEqual(["+3"]);
  });

  it("lists hardcore, finished and empty boards without bands", () => {
    const many = rows(Array.from({ length: 12 }, (_, i) => [12 - i] as [number]));
    expect(names((survivorsBoard(many, undefined) as { entries: BoardEntry[] }).entries)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "+4"]);
    // A finished classic arena has no zone readout, even with a lone winner below the zone.
    expect(survivorsBoard(rows([[3, "winner"], [5, "eliminated"]]), undefined).kind).toBe("list");
    expect(survivorsBoard([], zone(4, 5))).toEqual({ kind: "list", entries: [] });
  });

  it("shows Final Circle finalists and the eliminated separately", () => {
    const board = survivorsBoard(rows([[7], [7], [3, "eliminated"]]), { stage: "final_circle" });
    expect(board).toMatchObject({ kind: "final_circle", left: 2 });
    if (board.kind !== "final_circle") throw new Error("expected final circle");
    expect(names(board.finalists)).toEqual(["p1", "p2"]);
    expect(names(board.out)).toEqual(["p3"]);
  });
});
