import { describe, expect, it } from "vitest";
import { deriveRoundNumber, isRoundLive, parseFormat, parseSnapshot as parseNormalizedSnapshot } from "../snapshot.js";
import { defaultCs2FixturePath, loadCs2Fixture, parseFixtureSnapshot } from "../fixture.js";
import { buildCs2TeamIdentityMap } from "../team-identity.js";

const TEAM_A_ID = "00000000-0000-0000-0000-00000000000a";
const TEAM_B_ID = "00000000-0000-0000-0000-00000000000b";
const TEAM_IDENTITIES = buildCs2TeamIdentityMap([
  { gridTeamId: "team-a", teamId: TEAM_A_ID, name: "A" },
  { gridTeamId: "team-b", teamId: TEAM_B_ID, name: "B" },
]);

function parseSnapshot(raw: unknown) {
  return parseNormalizedSnapshot(raw, TEAM_IDENTITIES);
}

function rawWithGame(teams: unknown[], clock: unknown = { ticking: true, currentSeconds: 90 }) {
  return { data: { seriesState: { format: "best-of-3", games: [{ clock, teams }] } } };
}

describe("parseSnapshot", () => {
  it("parses a well-formed response into a two-team Cs2GameSnapshot", () => {
    const raw = rawWithGame(
      [
        { id: "team-a", name: "A", score: 3, deaths: 10, weaponKills: [{ weaponName: "ak47", count: 5 }], players: [{ id: "p1", kills: 2 }] },
        { id: "team-b", name: "B", score: 2, deaths: 8, weaponKills: [], players: [] },
      ],
      { ticking: true, currentSeconds: 90 },
    );
    const snapshot = parseSnapshot(raw);
    expect(snapshot).toEqual({
      teams: [
        { teamId: TEAM_A_ID, name: "A", score: 3, deaths: 10, weaponKills: [{ weaponName: "ak47", count: 5 }], players: [{ id: "p1", kills: 2 }] },
        { teamId: TEAM_B_ID, name: "B", score: 2, deaths: 8, weaponKills: [], players: [] },
      ],
      clock: { ticking: true, currentSeconds: 90 },
    });
  });

  it("returns undefined when games is empty (no live game)", () => {
    expect(parseSnapshot({ data: { seriesState: { games: [] } } })).toBeUndefined();
  });

  it("returns undefined when games is absent", () => {
    expect(parseSnapshot({ data: { seriesState: {} } })).toBeUndefined();
  });

  it("returns undefined for a team count other than 2", () => {
    const raw = rawWithGame([{ id: "team-a", name: "A", score: 0, deaths: 0, weaponKills: [], players: [] }]);
    expect(parseSnapshot(raw)).toBeUndefined();
  });

  it("returns undefined when clock is missing or malformed", () => {
    const teams = [
      { id: "team-a", name: "A", score: 0, deaths: 0, weaponKills: [], players: [] },
      { id: "team-b", name: "B", score: 0, deaths: 0, weaponKills: [], players: [] },
    ];
    expect(parseSnapshot({ data: { seriesState: { games: [{ teams }] } } })).toBeUndefined();
    expect(parseSnapshot(rawWithGame(teams, { ticking: "yes", currentSeconds: 90 }))).toBeUndefined();
  });

  it("returns undefined for a malformed/unrelated payload — never throws", () => {
    expect(parseSnapshot({ unexpected: true })).toBeUndefined();
    expect(parseSnapshot(null)).toBeUndefined();
    expect(parseSnapshot("not an object")).toBeUndefined();
  });

  it("returns undefined for missing or duplicate team identities", () => {
    const team = { name: "A", score: 0, deaths: 0, weaponKills: [], players: [] };
    expect(parseSnapshot(rawWithGame([{ ...team, id: "team-a" }, team]))).toBeUndefined();
    expect(parseSnapshot(rawWithGame([{ ...team, id: "same" }, { ...team, id: "same" }]))).toBeUndefined();
  });

  it("returns undefined when GRID reports a team outside the cached identity map", () => {
    const team = { score: 0, deaths: 0, weaponKills: [], players: [] };
    expect(
      parseSnapshot(
        rawWithGame([
          { ...team, id: "team-a", name: "A" },
          { ...team, id: "team-c", name: "C" },
        ]),
      ),
    ).toBeUndefined();
  });

  it("parses every recorded fixture snapshot that has a live game without throwing", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    expect(entries.length).toBeGreaterThan(0);
    let parsedCount = 0;
    for (const entry of entries) {
      const snapshot = parseFixtureSnapshot(entry.raw);
      if (snapshot !== undefined) parsedCount++;
    }
    expect(parsedCount).toBe(entries.length);
  });
});

describe("deriveRoundNumber", () => {
  it("is sum(scores) + 1", () => {
    const clock = { ticking: true, currentSeconds: 90 };
    expect(
      deriveRoundNumber({
        teams: [
          { teamId: "team-a", name: "A", score: 0, deaths: 0, weaponKills: [], players: [] },
          { teamId: "team-b", name: "B", score: 0, deaths: 0, weaponKills: [], players: [] },
        ],
        clock,
      }),
    ).toBe(1);
    expect(
      deriveRoundNumber({
        teams: [
          { teamId: "team-a", name: "A", score: 5, deaths: 0, weaponKills: [], players: [] },
          { teamId: "team-b", name: "B", score: 3, deaths: 0, weaponKills: [], players: [] },
        ],
        clock,
      }),
    ).toBe(9);
  });
});

describe("parseFormat", () => {
  it("parses best-of-N strings", () => {
    expect(parseFormat("best-of-1")).toBe(1);
    expect(parseFormat("best-of-3")).toBe(3);
    expect(parseFormat("best-of-5")).toBe(5);
  });

  it("returns undefined for unrecognized or missing input", () => {
    expect(parseFormat("bo3")).toBeUndefined();
    expect(parseFormat("best-of-x")).toBeUndefined();
    expect(parseFormat(undefined)).toBeUndefined();
  });
});

describe("isRoundLive", () => {
  const teams = (a: number, b: number) => [
    { teamId: "team-a", name: "A", score: a, deaths: 0, weaponKills: [], players: [] },
    { teamId: "team-b", name: "B", score: b, deaths: 0, weaponKills: [], players: [] },
  ] as const;

  it("is true when currentSeconds jumps up past the threshold and ticking is true", () => {
    const before = { teams: teams(0, 0), clock: { ticking: true, currentSeconds: 3 } };
    const after = { teams: teams(0, 0), clock: { ticking: true, currentSeconds: 108 } };
    expect(isRoundLive(before, after)).toBe(true);
  });

  it("is false while currentSeconds is merely counting down within the same round", () => {
    const before = { teams: teams(0, 0), clock: { ticking: true, currentSeconds: 60 } };
    const after = { teams: teams(0, 0), clock: { ticking: true, currentSeconds: 45 } };
    expect(isRoundLive(before, after)).toBe(false);
  });

  it("is false when the jump is present but ticking is false (e.g. a paused warmup snapshot)", () => {
    const before = { teams: teams(0, 0), clock: { ticking: false, currentSeconds: 18 } };
    const after = { teams: teams(0, 0), clock: { ticking: false, currentSeconds: 90 } };
    expect(isRoundLive(before, after)).toBe(false);
  });

  it("matches every observed round boundary in the recorded fixture (30 transitions, 0 false positives)", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    const snapshots = entries.map((e) => parseFixtureSnapshot(e.raw)).filter((s) => s !== undefined);
    let liveTransitions = 0;
    for (let i = 1; i < snapshots.length; i++) {
      if (isRoundLive(snapshots[i - 1]!, snapshots[i]!)) liveTransitions++;
    }
    expect(liveTransitions).toBe(30);
  });
});
