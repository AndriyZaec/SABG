import { describe, expect, it } from "vitest";
import type { PlayerLeaderboardEntry, PlayerLeaderboardResponse } from "@arena/contracts";
import { playerLeaderboardView } from "./playerLeaderboard.js";

const entry = (userId: string, rank: number): PlayerLeaderboardEntry =>
  ({ userId, username: userId, rank, points: 100 - rank, wins: 0, arenasPlayed: 1 });

const board = (entries: PlayerLeaderboardEntry[]): PlayerLeaderboardResponse =>
  ({ scope: { name: "November" }, competitions: [{ name: "BLAST" }], entries, computedAt: "2026-10-27T12:00:00.000Z" });

describe("playerLeaderboardView", () => {
  it("shows coming soon while no scope is current", () => {
    expect(playerLeaderboardView({ scope: null }, null)).toEqual({ kind: "coming_soon" });
  });

  it("keeps the title and an empty list for a scope without results", () => {
    expect(playerLeaderboardView({ scope: { name: "November" }, competitions: [], entries: [] }, null))
      .toEqual({ kind: "board", scopeName: "November", competitions: [], rows: [] });
  });

  it("highlights the viewer inside the top without pinning a second row", () => {
    const view = playerLeaderboardView(board([entry("a", 1), entry("me", 2)]), entry("me", 2));
    if (view.kind !== "board") throw new Error("expected board");
    expect(view.rows.map((row) => [row.userId, row.you])).toEqual([["a", false], ["me", true]]);
    expect(view.pinned).toBeUndefined();
    expect(view.me).toEqual(entry("me", 2));
  });

  it("pins the viewer's row below the top when they rank outside it", () => {
    const view = playerLeaderboardView(board([entry("a", 1), entry("b", 2)]), entry("me", 140));
    if (view.kind !== "board") throw new Error("expected board");
    expect(view.rows.some((row) => row.you)).toBe(false);
    expect(view.pinned).toEqual({ ...entry("me", 140), you: true });
    expect(view.me).toEqual(entry("me", 140));
  });

  it("marks nobody for a signed-out or unranked viewer", () => {
    const view = playerLeaderboardView(board([entry("a", 1)]), null);
    if (view.kind !== "board") throw new Error("expected board");
    expect(view.rows.map((row) => row.you)).toEqual([false]);
    expect(view.pinned).toBeUndefined();
    expect(view.me).toBeUndefined();
  });
});
