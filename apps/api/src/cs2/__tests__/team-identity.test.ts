import { describe, expect, it } from "vitest";
import { buildCs2TeamIdentityMap } from "../team-identity.js";

describe("buildCs2TeamIdentityMap", () => {
  it("indexes two internal identities by GRID ID", () => {
    const identities = buildCs2TeamIdentityMap([
      { gridTeamId: "grid-a", teamId: "internal-a", name: "Team A" },
      { gridTeamId: "grid-b", teamId: "internal-b", name: "Team B" },
    ]);

    expect(identities.get("grid-a")).toEqual({ teamId: "internal-a", name: "Team A" });
    expect(identities.get("grid-b")).toEqual({ teamId: "internal-b", name: "Team B" });
  });

  it("rejects duplicate GRID mappings", () => {
    expect(() =>
      buildCs2TeamIdentityMap([
        { gridTeamId: "same", teamId: "internal-a", name: "Team A" },
        { gridTeamId: "same", teamId: "internal-b", name: "Team B" },
      ]),
    ).toThrow("requires two distinct GRID teams");
  });
});
