import { describe, expect, it } from "vitest";
import { rankLeaderboard, resolveWinners, type LeaderboardAccumulator } from "../rank.js";

function row(overrides: Partial<LeaderboardAccumulator> = {}): LeaderboardAccumulator {
  return {
    userId: "u1",
    username: "user1",
    status: "active",
    score: 0,
    missedCount: 0,
    joinedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rankLeaderboard", () => {
  it("orders active/winner rows before eliminated ones, then by score descending", () => {
    const rows = [
      row({ userId: "eliminated-high-score", status: "eliminated", score: 5, joinedAt: "t1" }),
      row({ userId: "active-low-score", status: "active", score: 1, joinedAt: "t2" }),
      row({ userId: "active-high-score", status: "active", score: 3, joinedAt: "t3" }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.map((e) => e.userId)).toEqual([
      "active-high-score",
      "active-low-score",
      "eliminated-high-score",
    ]);
  });

  it("assigns shared rank only on a genuine full tie within the same status band", () => {
    const rows = [
      row({ userId: "a", status: "active", score: 4, joinedAt: "t1" }),
      row({ userId: "b", status: "active", score: 4, joinedAt: "t1" }),
      row({ userId: "c", status: "active", score: 2, joinedAt: "t3" }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.find((e) => e.userId === "a")?.rank).toBe(1);
    expect(entries.find((e) => e.userId === "b")?.rank).toBe(1);
    expect(entries.find((e) => e.userId === "c")?.rank).toBe(3);
  });

  it("orders equal-score rows by earlier joinedAt (spec §7 tie-break 3, display order only)", () => {
    const rows = [
      row({ userId: "later", status: "active", score: 1, joinedAt: "2024-01-02T00:00:00.000Z" }),
      row({ userId: "earlier", status: "active", score: 1, joinedAt: "2024-01-01T00:00:00.000Z" }),
    ];

    const entries = rankLeaderboard(rows);

    // Distinct ranks now — joinedAt is a real §7 rung for display, it just never changes winners.
    expect(entries.map((e) => e.userId)).toEqual(["earlier", "later"]);
    expect(entries[0]?.rank).toBe(1);
    expect(entries[1]?.rank).toBe(2);
  });

  it("orders equal-score rows by faster avg answer speed (spec §7 tie-break 1) when both have it", () => {
    const rows = [
      row({ userId: "slower", status: "active", score: 1, joinedAt: "t1", avgAnswerMs: 5000 }),
      row({ userId: "faster", status: "active", score: 1, joinedAt: "t2", avgAnswerMs: 1000 }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.map((e) => e.userId)).toEqual(["faster", "slower"]);
    expect(entries[0]?.rank).toBe(1);
    expect(entries[1]?.rank).toBe(2);
  });

  it("falls through to fewer missed rounds (spec §7 tie-break 2) when speed data is absent", () => {
    const rows = [
      row({ userId: "more-missed", status: "active", score: 1, joinedAt: "t1", missedCount: 2 }),
      row({ userId: "fewer-missed", status: "active", score: 1, joinedAt: "t2", missedCount: 0 }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.map((e) => e.userId)).toEqual(["fewer-missed", "more-missed"]);
    expect(entries[0]?.rank).toBe(1);
    expect(entries[1]?.rank).toBe(2);
  });

  it("shares rank on a genuine full tie across the whole chain (score, speed, missed, joinedAt all equal)", () => {
    const rows = [
      row({ userId: "a", status: "active", score: 3, joinedAt: "t1", avgAnswerMs: 2000, missedCount: 1 }),
      row({ userId: "b", status: "active", score: 3, joinedAt: "t1", avgAnswerMs: 2000, missedCount: 1 }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries[0]?.rank).toBe(1);
    expect(entries[1]?.rank).toBe(1);
  });

  it("carries score/missedCount/joinedAt through and leaves avgAnswerMs unset when absent", () => {
    const rows = [row({ userId: "u1", score: 7, missedCount: 2, joinedAt: "t1" })];

    const [entry] = rankLeaderboard(rows);

    expect(entry).toMatchObject({ userId: "u1", score: 7, missedCount: 2, joinedAt: "t1" });
    expect(entry?.avgAnswerMs).toBeUndefined();
  });

  it("carries avgAnswerMs through when set", () => {
    const rows = [row({ userId: "u1", avgAnswerMs: 1234 })];

    const [entry] = rankLeaderboard(rows);

    expect(entry?.avgAnswerMs).toBe(1234);
  });
});

describe("resolveWinners", () => {
  it("returns every finalist's userId — no tie-break selection, equal split is left to the payout service", () => {
    const finalists = [row({ userId: "a" }), row({ userId: "b" }), row({ userId: "c" })];

    expect(resolveWinners(finalists)).toEqual(["a", "b", "c"]);
  });

  it("returns a single id for a lone finalist", () => {
    expect(resolveWinners([row({ userId: "solo" })])).toEqual(["solo"]);
  });

  it("returns an empty list for an empty finalist set", () => {
    expect(resolveWinners([])).toEqual([]);
  });
});
