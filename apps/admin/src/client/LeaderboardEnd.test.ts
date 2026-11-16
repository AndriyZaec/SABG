import { describe, expect, it } from "vitest";
import type { AdminLeaderboardEntry, AdminLeaderboardResponse, AdminLeaderboardScope } from "@arena/contracts";
import { endScopeBlockers } from "./LeaderboardEnd.js";

const scope = (prizePlaces: number[]): AdminLeaderboardScope => ({
  id: "iem", name: "IEM", status: "open", current: true, competitionCount: 1, unfinishedCompetitions: [],
  prizes: prizePlaces.map((place) => ({ place, imageUrl: `https://cdn.test/${place}.png` })),
});

const entry = (userId: string, rank: number, prizePlace?: number): AdminLeaderboardEntry => ({
  userId, username: userId, rank, points: 10, wins: 0, secondPlaces: 0, roundsPlayed: 1, arenasPlayed: 1, totalPayoutLamports: 0,
  disqualified: false, ...(prizePlace !== undefined ? { prizePlace } : {}),
});

const board = (overrides: Partial<NonNullable<AdminLeaderboardResponse["current"]>> = {}) =>
  ({ scopeId: "iem", entries: [], marks: [], drafts: [], ...overrides });

const approved = (userId: string) => ({ userId, status: "approved" as const, appliedAt: "2026-11-16T12:00:00.000Z" });

describe("endScopeBlockers", () => {
  it("blocks a scope without prizes only on staged drafts", () => {
    expect(endScopeBlockers(scope([]), board({ entries: [entry("ace", 1)] }))).toEqual([]);
    expect(endScopeBlockers(scope([]), board({
      entries: [entry("ace", 1)],
      drafts: [{ userId: "ace", action: "approve", actorLogin: "admin", updatedAt: "2026-11-16T12:00:00.000Z" }],
    }))).toEqual(["1 staged mark change is not applied."]);
  });

  it("blocks on staged drafts and on prize players without an applied approval", () => {
    const blockers = endScopeBlockers(scope([1, 2]), board({
      entries: [entry("ace", 1, 1), entry("bolt", 2, 2), entry("cub", 3)],
      marks: [approved("ace"), { userId: "bolt", status: "disqualified", reason: "x", appliedAt: "2026-11-16T12:00:00.000Z" }],
      drafts: [{ userId: "bolt", action: "approve", actorLogin: "admin", updatedAt: "2026-11-16T12:00:00.000Z" }],
    }));
    expect(blockers).toEqual([
      "1 staged mark change is not applied.",
      "bolt holds place 2 without an applied approval.",
    ]);
  });

  it("is ready when every held prize place is approved, even with a place nobody holds", () => {
    expect(endScopeBlockers(scope([1, 2]), board({ entries: [entry("ace", 1, 1)], marks: [approved("ace")] }))).toEqual([]);
  });
});
