import { describe, expect, it } from "vitest";
import { deriveRoundNumber, parseFormat, parseSnapshot } from "../snapshot.js";
import { defaultCs2FixturePath, loadCs2Fixture } from "../fixture.js";

function rawWithGame(teams: unknown[]) {
  return { data: { seriesState: { format: "best-of-3", games: [{ teams }] } } };
}

describe("parseSnapshot", () => {
  it("parses a well-formed response into a two-team Cs2GameSnapshot", () => {
    const raw = rawWithGame([
      { name: "A", score: 3, deaths: 10, weaponKills: [{ weaponName: "ak47", count: 5 }], players: [{ id: "p1", kills: 2 }] },
      { name: "B", score: 2, deaths: 8, weaponKills: [], players: [] },
    ]);
    const snapshot = parseSnapshot(raw);
    expect(snapshot).toEqual({
      teams: [
        { name: "A", score: 3, deaths: 10, weaponKills: [{ weaponName: "ak47", count: 5 }], players: [{ id: "p1", kills: 2 }] },
        { name: "B", score: 2, deaths: 8, weaponKills: [], players: [] },
      ],
    });
  });

  it("returns undefined when games is empty (no live game)", () => {
    expect(parseSnapshot({ data: { seriesState: { games: [] } } })).toBeUndefined();
  });

  it("returns undefined when games is absent", () => {
    expect(parseSnapshot({ data: { seriesState: {} } })).toBeUndefined();
  });

  it("returns undefined for a team count other than 2", () => {
    const raw = rawWithGame([{ name: "A", score: 0, deaths: 0, weaponKills: [], players: [] }]);
    expect(parseSnapshot(raw)).toBeUndefined();
  });

  it("returns undefined for a malformed/unrelated payload — never throws", () => {
    expect(parseSnapshot({ unexpected: true })).toBeUndefined();
    expect(parseSnapshot(null)).toBeUndefined();
    expect(parseSnapshot("not an object")).toBeUndefined();
  });

  it("parses every recorded fixture snapshot that has a live game without throwing", () => {
    const entries = loadCs2Fixture(defaultCs2FixturePath());
    expect(entries.length).toBeGreaterThan(0);
    let parsedCount = 0;
    for (const entry of entries) {
      const snapshot = parseSnapshot(entry.raw);
      if (snapshot !== undefined) parsedCount++;
    }
    // Every recorded poll in this fixture has a live game (the recorder only writes while
    // games is non-empty — recording-session.ts).
    expect(parsedCount).toBe(entries.length);
  });
});

describe("deriveRoundNumber", () => {
  it("is sum(scores) + 1", () => {
    expect(deriveRoundNumber({ teams: [{ name: "A", score: 0, deaths: 0, weaponKills: [], players: [] }, { name: "B", score: 0, deaths: 0, weaponKills: [], players: [] }] })).toBe(1);
    expect(deriveRoundNumber({ teams: [{ name: "A", score: 5, deaths: 0, weaponKills: [], players: [] }, { name: "B", score: 3, deaths: 0, weaponKills: [], players: [] }] })).toBe(9);
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
