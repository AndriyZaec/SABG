import { describe, expect, it } from "vitest";
import { parseSeriesSnapshot } from "../series-snapshot.js";

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
          { name: "A", score: 0, won: false },
          { name: "B", score: 0, won: false },
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
        { name: "ICP", score: 1, won: false },
        { name: "ENCE", score: 0, won: false },
      ],
      games: [{ some: "map-state" }],
    });
    expect(parseSeriesSnapshot(raw)).toEqual({
      format: 3,
      finished: false,
      hasLiveGame: true,
      teams: [
        { name: "ICP", score: 1, won: false },
        { name: "ENCE", score: 0, won: false },
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

  // data-assumptions.md #12: a forfeited map never produces a games[] entry — the only trace is
  // this discontinuous jump in the series-level envelope (score jumping by more than one increment,
  // finished flipping true) — modeled here on the observed shape from series 2985953 (ICP vs ENCE).
  it("parses the forfeit envelope shape: score jumps by more than one, finished true, no games", () => {
    const raw = rawSeries({
      format: "best-of-3",
      finished: true,
      teams: [
        { name: "ICP", score: 2, won: true },
        { name: "ENCE", score: 0, won: false },
      ],
      games: [],
    });
    expect(parseSeriesSnapshot(raw)).toEqual({
      format: 3,
      finished: true,
      hasLiveGame: false,
      teams: [
        { name: "ICP", score: 2, won: true },
        { name: "ENCE", score: 0, won: false },
      ],
    });
  });

  it("returns undefined for a team count other than 2", () => {
    expect(parseSeriesSnapshot(rawSeries({ teams: [{ name: "A", score: 0, won: false }] }))).toBeUndefined();
  });

  it("returns undefined for a malformed/unrelated payload — never throws", () => {
    expect(parseSeriesSnapshot({ unexpected: true })).toBeUndefined();
    expect(parseSeriesSnapshot(null)).toBeUndefined();
    expect(parseSeriesSnapshot("not an object")).toBeUndefined();
    expect(parseSeriesSnapshot({ data: { seriesState: null } })).toBeUndefined();
  });
});
