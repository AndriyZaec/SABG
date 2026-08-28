import { describe, expect, it } from "vitest";
import { parseSeriesSnapshot as parseNormalizedSeriesSnapshot } from "../series-snapshot.js";
import type { Cs2TeamIdentityMap } from "../team-identity.js";

const TEAM_A_ID = "00000000-0000-0000-0000-00000000000a";
const TEAM_B_ID = "00000000-0000-0000-0000-00000000000b";
const ICP_ID = "00000000-0000-0000-0000-00000000000c";
const ENCE_ID = "00000000-0000-0000-0000-00000000000d";
const TEAM_IDENTITIES: Cs2TeamIdentityMap = new Map([
  ["team-a", { teamId: TEAM_A_ID, name: "A" }],
  ["team-b", { teamId: TEAM_B_ID, name: "B" }],
  ["icp", { teamId: ICP_ID, name: "ICP" }],
  ["ence", { teamId: ENCE_ID, name: "ENCE" }],
]);

function parseSeriesSnapshot(raw: unknown) {
  return parseNormalizedSeriesSnapshot(raw, TEAM_IDENTITIES);
}

function rawSeries(opts: {
  format?: string;
  finished?: boolean;
  teams?: unknown[];
  games?: unknown[];
}) {
  return {
    data: {
      seriesState: {
        format: opts.format ?? "best-of-3",
        finished: opts.finished ?? false,
        teams: opts.teams ?? [
          { id: "team-a", name: "A", score: 0, won: false },
          { id: "team-b", name: "B", score: 0, won: false },
        ],
        ...(opts.games !== undefined ? { games: opts.games } : {}),
      },
    },
  };
}

describe("parseSeriesSnapshot", () => {
  it("parses a well-formed series-level response", () => {
    const raw = rawSeries({
      format: "best-of-3",
      finished: false,
      teams: [
        { id: "icp", name: "ICP", score: 1, won: false },
        { id: "ence", name: "ENCE", score: 0, won: false },
      ],
      games: [{ some: "map-state" }],
    });
    expect(parseSeriesSnapshot(raw)).toEqual({
      format: 3,
      finished: false,
      hasLiveGame: true,
      teams: [
        { teamId: ICP_ID, name: "ICP", score: 1, won: false },
        { teamId: ENCE_ID, name: "ENCE", score: 0, won: false },
      ],
    });
  });

  it("hasLiveGame is false when games is empty or absent", () => {
    expect(parseSeriesSnapshot(rawSeries({ games: [] }))?.hasLiveGame).toBe(false);
    expect(parseSeriesSnapshot(rawSeries({}))?.hasLiveGame).toBe(false);
  });

  it("format is undefined when GRID's format string doesn't parse", () => {
    expect(parseSeriesSnapshot(rawSeries({ format: "bo3" }))?.format).toBeUndefined();
  });

  // A forfeited map may surface only as a series-score jump with no live game.
  it("parses the forfeit envelope shape: score jumps by more than one, finished true, no games", () => {
    const raw = rawSeries({
      format: "best-of-3",
      finished: true,
      teams: [
        { id: "icp", name: "ICP", score: 2, won: true },
        { id: "ence", name: "ENCE", score: 0, won: false },
      ],
      games: [],
    });
    expect(parseSeriesSnapshot(raw)).toEqual({
      format: 3,
      finished: true,
      hasLiveGame: false,
      teams: [
        { teamId: ICP_ID, name: "ICP", score: 2, won: true },
        { teamId: ENCE_ID, name: "ENCE", score: 0, won: false },
      ],
    });
  });

  it("returns undefined for a team count other than 2", () => {
    expect(parseSeriesSnapshot(rawSeries({ teams: [{ id: "team-a", name: "A", score: 0, won: false }] }))).toBeUndefined();
  });

  it("returns undefined for missing or duplicate team identities", () => {
    const team = { name: "A", score: 0, won: false };
    expect(parseSeriesSnapshot(rawSeries({ teams: [{ ...team, id: "team-a" }, team] }))).toBeUndefined();
    expect(parseSeriesSnapshot(rawSeries({ teams: [{ ...team, id: "same" }, { ...team, id: "same" }] }))).toBeUndefined();
  });

  it("returns undefined when a participant is outside the cached identity map", () => {
    expect(
      parseSeriesSnapshot(
        rawSeries({
          teams: [
            { id: "team-a", name: "A", score: 0, won: false },
            { id: "team-c", name: "C", score: 0, won: false },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a malformed/unrelated payload — never throws", () => {
    expect(parseSeriesSnapshot({ unexpected: true })).toBeUndefined();
    expect(parseSeriesSnapshot(null)).toBeUndefined();
    expect(parseSeriesSnapshot("not an object")).toBeUndefined();
    expect(parseSeriesSnapshot({ data: { seriesState: null } })).toBeUndefined();
  });
});
