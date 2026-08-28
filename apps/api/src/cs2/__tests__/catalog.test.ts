import { describe, expect, it } from "vitest";
import { CS2_TOPICS, CS2_WEAPON_WHITELIST } from "@arena/contracts";
import {
  buildCs2GeneralCandidates,
  buildCs2SettlementCondition,
  pickCs2Candidate,
  renderCs2Question,
} from "../catalog.js";

const TEAMS = [
  { teamId: "astralis", name: "Astralis" },
  { teamId: "navi", name: "NAVI" },
] as const;

describe("buildCs2GeneralCandidates", () => {
  it("excludes fixed-round topics from the general catalog", () => {
    const topics = new Set(buildCs2GeneralCandidates(TEAMS).map((candidate) => candidate.topic));
    expect(topics).toEqual(new Set(["round_winner", "weapon_kill", "team_ace", "multikill", "survivors_team", "survivors_round"]));
  });

  it("covers every whitelisted weapon exactly once", () => {
    const weaponCandidates = buildCs2GeneralCandidates(TEAMS).filter((candidate) => candidate.topic === "weapon_kill");
    expect(weaponCandidates.map((candidate) => candidate.params.weapon).sort()).toEqual([...CS2_WEAPON_WHITELIST].sort());
  });

  it("pickCs2Candidate always returns a member of the pool", () => {
    for (let i = 0; i < 50; i++) {
      const candidates = buildCs2GeneralCandidates(TEAMS);
      const picked = pickCs2Candidate(TEAMS);
      expect(candidates).toContainEqual(picked);
    }
  });
});

describe("renderCs2Question", () => {
  it("renders every topic without throwing, using team names when supplied", () => {
    for (const topic of CS2_TOPICS) {
      const params =
        topic === "weapon_kill"
          ? { weapon: "ak47" as const }
          : topic === "ot_score"
            ? {}
            : topic === "survivors_round"
              ? { y: 3 }
              : topic === "multikill" || topic === "survivors_team"
                ? { targetTeamId: "astralis", y: 3 }
                : { targetTeamId: "astralis" };
      const question = renderCs2Question(topic, params, TEAMS);
      expect(question.length).toBeGreaterThan(0);
      if ("targetTeamId" in params) expect(question).toContain("Astralis");
    }
  });

  it("rejects an unknown team identity instead of rendering a fallback", () => {
    expect(() => renderCs2Question("round_winner", { targetTeamId: "missing" }, TEAMS)).toThrow(
      'unknown targetTeamId "missing"',
    );
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
