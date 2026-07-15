import { describe, expect, it } from "vitest";
import { resolveFixtureTeams } from "../fixture-metadata.js";

describe("resolveFixtureTeams", () => {
  it("returns the seeded team names for a listed fixture", () => {
    expect(resolveFixtureTeams(18209181)).toEqual({ homeTeam: "France", awayTeam: "Morocco" });
  });

  it("returns undefined for a fixture that isn't seeded", () => {
    expect(resolveFixtureTeams(999999999)).toBeUndefined();
  });
});
