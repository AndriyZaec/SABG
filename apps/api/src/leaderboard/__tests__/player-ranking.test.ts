import { describe, expect, it } from "vitest";
import { assignPrizePlaces, rankPlayers, type PlayerArenaResult } from "../player-ranking.js";

function result(userId: string, overrides: Partial<PlayerArenaResult> = {}): PlayerArenaResult {
  return { userId, score: 5, rank: 3, won: false, roundsPlayed: 10, ...overrides };
}

const order = (rows: ReturnType<typeof rankPlayers>) => rows.map((row) => [row.userId, row.rank]);

describe("rankPlayers", () => {
  it("sums each player's arenas into points, wins, 2nd places, rounds and payout", () => {
    const rows = rankPlayers(
      [
        result("a", { score: 9, rank: 1, won: true, roundsPlayed: 24 }),
        result("a", { score: 4, rank: 2, roundsPlayed: 12 }),
        result("b", { score: 6, rank: 1, won: true, roundsPlayed: 20 }),
      ],
      new Map([["a", 1500], ["b", 700]]),
    );
    expect(rows).toEqual([
      { userId: "a", rank: 1, points: 13, arenasPlayed: 2, wins: 1, secondPlaces: 1, roundsPlayed: 36, totalScore: 13, totalPayoutLamports: 1500, disqualified: false },
      { userId: "b", rank: 2, points: 6, arenasPlayed: 1, wins: 1, secondPlaces: 0, roundsPlayed: 20, totalScore: 6, totalPayoutLamports: 700, disqualified: false },
    ]);
  });

  it("ranks by points first", () => {
    expect(order(rankPlayers([result("low", { score: 3, won: true }), result("high", { score: 8 })], new Map())))
      .toEqual([["high", 1], ["low", 2]]);
  });

  it("breaks a points tie by more wins", () => {
    expect(order(rankPlayers([result("a"), result("b", { won: true })], new Map()))).toEqual([["b", 1], ["a", 2]]);
  });

  it("then by more 2nd places", () => {
    expect(order(rankPlayers([result("a"), result("b", { rank: 2 })], new Map()))).toEqual([["b", 1], ["a", 2]]);
  });

  it("then by more rounds played", () => {
    expect(order(rankPlayers([result("a", { roundsPlayed: 8 }), result("b", { roundsPlayed: 9 })], new Map())))
      .toEqual([["b", 1], ["a", 2]]);
  });

  it("then by fewer arenas", () => {
    const rows = rankPlayers(
      [
        result("two", { score: 3, roundsPlayed: 5 }),
        result("two", { score: 3, roundsPlayed: 5 }),
        result("one", { score: 6, roundsPlayed: 10 }),
      ],
      new Map(),
    );
    expect(order(rows)).toEqual([["one", 1], ["two", 2]]);
  });

  it("shares the rank on a full tie and skips the next one", () => {
    const rows = rankPlayers([result("b"), result("a"), result("c", { score: 1 })], new Map());
    expect(order(rows)).toEqual([["a", 1], ["b", 1], ["c", 3]]);
  });

  it("returns no rows without results and ignores payouts of players without results", () => {
    expect(rankPlayers([], new Map([["a", 100]]))).toEqual([]);
  });
});

describe("rankPlayers with disqualified players", () => {
  const board = (rows: ReturnType<typeof rankPlayers>) => rows.map((row) => [row.userId, row.rank, row.disqualified]);
  const results = [result("a", { score: 100 }), result("b", { score: 90 }), result("c", { score: 80 })];

  it("matches the plain ranking when nobody is disqualified", () => {
    const tied = [...results, result("d", { score: 80 }), result("e", { score: 10 })];
    expect(rankPlayers(tied, new Map(), new Set())).toEqual(rankPlayers(tied, new Map()));
  });

  it("ranks real players without the disqualified one, who shares the rank of the player that moved up", () => {
    expect(board(rankPlayers(results, new Map(), new Set(["b"])))).toEqual([["a", 1, false], ["b", 2, true], ["c", 2, false]]);
  });

  it("gives a disqualified last player a rank past the last real one", () => {
    const rows = rankPlayers([result("a", { score: 100 }), result("c", { score: 80 }), result("b", { score: 50 })], new Map(), new Set(["b"]));
    expect(board(rows)).toEqual([["a", 1, false], ["c", 2, false], ["b", 3, true]]);
  });

  it("gives a disqualified player tied with a real one that real player's rank, whatever their ids", () => {
    for (const [cheat, real] of [["b", "z"], ["z", "b"]] as const) {
      const rows = rankPlayers([result("a", { score: 100 }), result(cheat, { score: 90 }), result(real, { score: 90 })], new Map(), new Set([cheat]));
      expect(board(rows)).toEqual([["a", 1, false], [cheat, 2, true], [real, 2, false]]);
    }
  });

  it("ranks two disqualified players each against the real players only", () => {
    const rows = rankPlayers([...results, result("d", { score: 85 })], new Map(), new Set(["b", "d"]));
    expect(board(rows)).toEqual([["a", 1, false], ["b", 2, true], ["d", 2, true], ["c", 2, false]]);
  });

  it("moves everyone up under a disqualified leader", () => {
    expect(board(rankPlayers(results, new Map(), new Set(["a"])))).toEqual([["a", 1, true], ["b", 1, false], ["c", 2, false]]);
  });

  it("keeps a disqualified player's totals", () => {
    const [row] = rankPlayers([result("a", { score: 7, won: true })], new Map([["a", 400]]), new Set(["a"]));
    expect(row).toMatchObject({ points: 7, wins: 1, totalPayoutLamports: 400, disqualified: true, rank: 1 });
  });
});

describe("assignPrizePlaces", () => {
  const row = (userId: string, disqualified = false) => ({ userId, disqualified });

  it("spreads a full tie over consecutive places", () => {
    const rows = rankPlayers([result("a"), result("b"), result("c", { score: 1 })], new Map());
    expect(rows.map((entry) => entry.rank)).toEqual([1, 1, 3]);
    expect([...assignPrizePlaces(rows, [1, 2, 3])]).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("skips disqualified rows", () => {
    expect([...assignPrizePlaces([row("a"), row("b", true), row("c"), row("d")], [1, 2])]).toEqual([["a", 1], ["c", 2]]);
  });

  it("leaves places without a player unassigned, and gives no place without a prize", () => {
    expect([...assignPrizePlaces([row("a"), row("b")], [1, 3, 5])]).toEqual([["a", 1]]);
    expect(assignPrizePlaces([row("a")], []).size).toBe(0);
  });
});
