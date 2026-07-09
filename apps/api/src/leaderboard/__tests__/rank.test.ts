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

  it("assigns shared rank to equal scores within the same status band (full tie)", () => {
    const rows = [
      row({ userId: "a", status: "active", score: 4, joinedAt: "t1" }),
      row({ userId: "b", status: "active", score: 4, joinedAt: "t2" }),
      row({ userId: "c", status: "active", score: 2, joinedAt: "t3" }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.find((e) => e.userId === "a")?.rank).toBe(1);
    expect(entries.find((e) => e.userId === "b")?.rank).toBe(1);
    expect(entries.find((e) => e.userId === "c")?.rank).toBe(3);
  });

  it("breaks ties in equal-score rows by earlier joinedAt, for stable display order only", () => {
    const rows = [
      row({ userId: "later", status: "active", score: 1, joinedAt: "2024-01-02T00:00:00.000Z" }),
      row({ userId: "earlier", status: "active", score: 1, joinedAt: "2024-01-01T00:00:00.000Z" }),
    ];

    const entries = rankLeaderboard(rows);

    expect(entries.map((e) => e.userId)).toEqual(["earlier", "later"]);
    // Still a full tie in rank — ordering is display-only, never a spec §7 winner tie-break.
    expect(entries[0]?.rank).toBe(1);
    expect(entries[1]?.rank).toBe(1);
  });

  it("carries score/missedCount/joinedAt through and leaves avgAnswerMs unset", () => {
    const rows = [row({ userId: "u1", score: 7, missedCount: 2, joinedAt: "t1" })];

    const [entry] = rankLeaderboard(rows);

    expect(entry).toMatchObject({ userId: "u1", score: 7, missedCount: 2, joinedAt: "t1" });
    expect(entry?.avgAnswerMs).toBeUndefined();
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
