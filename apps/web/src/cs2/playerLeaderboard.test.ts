import { describe, expect, it } from "vitest";
import type { PlayerLeaderboardEntry, PlayerLeaderboardMeResponse, PlayerLeaderboardResponse } from "@arena/contracts";
import { playerLeaderboardView } from "./playerLeaderboard.js";

const entry = (userId: string, rank: number, extra: Partial<PlayerLeaderboardEntry> = {}): PlayerLeaderboardEntry =>
  ({ userId, username: userId, rank, points: 100 - rank, wins: 0, arenasPlayed: 1, disqualified: false, ...extra });

const AWP = { place: 1, imageUrl: "https://cdn.test/skins/awp.png" };
const AK = { place: 2, imageUrl: "https://cdn.test/skins/ak.png" };

const board = (entries: PlayerLeaderboardEntry[], extra: Partial<Extract<PlayerLeaderboardResponse, { prizes: unknown }>> = {}): PlayerLeaderboardResponse =>
  ({ scope: { name: "November", finalized: false }, competitions: [{ name: "BLAST" }], prizes: [], entries, computedAt: "2026-10-27T12:00:00.000Z", ...extra });

const mine = (own: PlayerLeaderboardEntry | null, extra: Omit<PlayerLeaderboardMeResponse, "entry"> = {}): PlayerLeaderboardMeResponse =>
  ({ entry: own, ...extra });

const expectBoard = (view: ReturnType<typeof playerLeaderboardView>) => {
  if (view.kind !== "board") throw new Error("expected board");
  return view;
};

describe("playerLeaderboardView", () => {
  it("shows coming soon while no scope is shown", () => {
    expect(playerLeaderboardView({ scope: null }, null)).toEqual({ kind: "coming_soon" });
  });

  it("keeps the title and an empty list for a scope without results", () => {
    expect(playerLeaderboardView({ scope: { name: "November", finalized: false }, competitions: [], prizes: [], entries: [] }, null))
      .toEqual({ kind: "board", scopeName: "November", finalized: false, competitions: [], prizes: [], rows: [] });
  });

  it("highlights the viewer inside the top without pinning a second row", () => {
    const view = expectBoard(playerLeaderboardView(board([entry("a", 1), entry("me", 2)]), mine(entry("me", 2))));
    expect(view.rows.map((row) => [row.userId, row.you])).toEqual([["a", false], ["me", true]]);
    expect(view.pinned).toBeUndefined();
    expect(view.me).toEqual({ ...entry("me", 2), you: true });
  });

  it("pins the viewer's row below the top when they rank outside it", () => {
    const view = expectBoard(playerLeaderboardView(board([entry("a", 1), entry("b", 2)]), mine(entry("me", 140))));
    expect(view.rows.some((row) => row.you)).toBe(false);
    expect(view.pinned).toEqual({ ...entry("me", 140), you: true });
    expect(view.me).toEqual({ ...entry("me", 140), you: true });
  });

  it("marks nobody for a signed-out or unranked viewer", () => {
    for (const viewer of [null, mine(null)]) {
      const view = expectBoard(playerLeaderboardView(board([entry("a", 1)]), viewer));
      expect(view.rows.map((row) => row.you)).toEqual([false]);
      expect(view.pinned).toBeUndefined();
      expect(view.me).toBeUndefined();
    }
  });

  it("gives a row the prize of its prize place, and none to a disqualified row or one without a place", () => {
    const view = expectBoard(playerLeaderboardView(board([
      entry("a", 1, { prizePlace: 1 }),
      entry("cheat", 2, { disqualified: true }),
      entry("b", 2, { prizePlace: 2 }),
      entry("c", 3),
    ], { prizes: [AWP, AK] }), mine(entry("b", 2))));
    expect(view.prizes).toEqual([AWP, AK]);
    expect(view.rows.map((row) => [row.userId, row.disqualified, row.prize])).toEqual([
      ["a", false, AWP],
      ["cheat", true, undefined],
      ["b", false, AK],
      ["c", false, undefined],
    ]);
    // The viewer's own row comes from the board, so it keeps its prize.
    expect(view.me?.prize).toEqual(AK);
  });

  it("keeps the viewer's disqualification reason and prize claim on a finalized scope", () => {
    const claim = { ...AWP, sent: false };
    const view = expectBoard(playerLeaderboardView(
      board([entry("me", 1, { prizePlace: 1 })], { scope: { name: "IEM", finalized: true }, prizes: [AWP] }),
      mine(entry("me", 1), { prize: claim }),
    ));
    expect(view).toMatchObject({ finalized: true, claim });
    expect(view.disqualificationReason).toBeUndefined();

    const disqualified = expectBoard(playerLeaderboardView(
      board([entry("me", 1, { disqualified: true })]),
      mine(entry("me", 1, { disqualified: true }), { disqualificationReason: "Several accounts" }),
    ));
    expect(disqualified.disqualificationReason).toBe("Several accounts");
    expect(disqualified.claim).toBeUndefined();
  });
});
