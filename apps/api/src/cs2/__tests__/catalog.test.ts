import { describe, expect, it } from "vitest";
import { CS2_TOPICS, CS2_WEAPON_WHITELIST } from "@arena/contracts";
import { CS2_GENERAL_CANDIDATES, buildCs2SettlementCondition, pickCs2Candidate, renderCs2Question } from "../catalog.js";

describe("CS2_GENERAL_CANDIDATES", () => {
  it("excludes fixed-round topics from the general catalog", () => {
    const topics = new Set(CS2_GENERAL_CANDIDATES.map((c) => c.topic));
    expect(topics).toEqual(new Set(["round_winner", "weapon_kill", "team_ace", "multikill", "survivors_team", "survivors_round"]));
  });

  it("covers every whitelisted weapon exactly once", () => {
    const weaponCandidates = CS2_GENERAL_CANDIDATES.filter((c) => c.topic === "weapon_kill");
    expect(weaponCandidates.map((c) => c.params.weapon).sort()).toEqual([...CS2_WEAPON_WHITELIST].sort());
  });

  it("pickCs2Candidate always returns a member of the pool", () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickCs2Candidate();
      expect(CS2_GENERAL_CANDIDATES).toContainEqual(picked);
    }
  });
});

describe("renderCs2Question", () => {
  it("renders every topic without throwing, using team names when supplied", () => {
    const teamNames = { home: "Astralis", away: "NAVI" };
    for (const topic of CS2_TOPICS) {
      const params =
        topic === "weapon_kill"
          ? { weapon: "ak47" as const }
          : topic === "ot_score"
            ? {}
            : topic === "survivors_round"
              ? { y: 3 }
              : topic === "multikill" || topic === "survivors_team"
                ? { targetTeam: "home" as const, y: 3 }
                : { targetTeam: "home" as const };
      const question = renderCs2Question(topic, params, teamNames);
      expect(question.length).toBeGreaterThan(0);
      if ("targetTeam" in params) expect(question).toContain("Astralis");
    }
  });

  it("falls back to Home/Away labels when teamNames is omitted", () => {
    expect(renderCs2Question("round_winner", { targetTeam: "home" })).toContain("Home");
    expect(renderCs2Question("round_winner", { targetTeam: "away" })).toContain("Away");
  });
});

describe("buildCs2SettlementCondition", () => {
  it("bundles discipline/resolve alongside the given topic/params/roundNumber", () => {
    expect(buildCs2SettlementCondition("weapon_kill", { weapon: "awp" }, 7)).toEqual({
      discipline: "cs2",
      topic: "weapon_kill",
      params: { weapon: "awp" },
      roundNumber: 7,
      resolve: "snapshot_diff",
    });
  });
});
