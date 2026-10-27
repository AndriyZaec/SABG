import { describe, expect, it } from "vitest";
import { rankPlayers, type PlayerArenaResult } from "../player-ranking.js";

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
      { userId: "a", rank: 1, points: 13, arenasPlayed: 2, wins: 1, secondPlaces: 1, roundsPlayed: 36, totalScore: 13, totalPayoutLamports: 1500 },
      { userId: "b", rank: 2, points: 6, arenasPlayed: 1, wins: 1, secondPlaces: 0, roundsPlayed: 20, totalScore: 6, totalPayoutLamports: 700 },
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
