import { describe, expect, it } from "vitest";
import { CS2_TOPICS, CS2_WEAPON_WHITELIST } from "@arena/contracts";
import {
  buildCs2GeneralCandidates,
  buildCs2SettlementCondition,
  eligibleCs2Candidates,
  pickCs2Candidate,
  renderCs2Question,
  type Cs2Candidate,
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
      const picked = pickCs2Candidate({ teams: TEAMS, roundNumber: 10, previousCandidate: undefined });
      expect(candidates).toContainEqual(picked);
    }
  });
});

describe("eligibleCs2Candidates", () => {
  it("excludes flat-pool topics (round_winner, survivors_team) on the easy tier", () => {
    const pool = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 3, previousCandidate: undefined });
    expect(pool.some((c) => c.topic === "round_winner" || c.topic === "survivors_team")).toBe(false);
  });

  it("includes flat-pool topics from the medium tier onward", () => {
    const medium = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 10, previousCandidate: undefined });
    const hard = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 20, previousCandidate: undefined });
    expect(medium.some((c) => c.topic === "round_winner")).toBe(true);
    expect(hard.some((c) => c.topic === "survivors_team")).toBe(true);
  });

  it("Round 1 allows glock/usp_silencer (pistol exception) but bans ak47/awp/molotov/hegrenade", () => {
    const pool = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 1, previousCandidate: undefined });
    const weapons = new Set(pool.filter((c) => c.topic === "weapon_kill").map((c) => c.params.weapon));
    expect(weapons.has("glock")).toBe(true);
    expect(weapons.has("usp_silencer")).toBe(true);
    for (const banned of ["ak47", "awp", "molotov", "hegrenade"] as const) {
      expect(weapons.has(banned)).toBe(false);
    }
  });

  it("bans molotov/hegrenade (easy-tier weapons) on rounds 1-2 but allows them on round 3", () => {
    for (const roundNumber of [1, 2]) {
      const pool = eligibleCs2Candidates({ teams: TEAMS, roundNumber, previousCandidate: undefined });
      const weapons = new Set(pool.filter((c) => c.topic === "weapon_kill").map((c) => c.params.weapon));
      expect(weapons.has("molotov")).toBe(false);
      expect(weapons.has("hegrenade")).toBe(false);
    }
    const round3Weapons = new Set(
      eligibleCs2Candidates({ teams: TEAMS, roundNumber: 3, previousCandidate: undefined })
        .filter((c) => c.topic === "weapon_kill")
        .map((c) => c.params.weapon),
    );
    expect(round3Weapons.has("molotov")).toBe(true);
    expect(round3Weapons.has("hegrenade")).toBe(true);
  });

  it("ak47/awp (hard-tier weapons) become eligible once a round reaches the hard tier", () => {
    const hardPool = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 20, previousCandidate: undefined });
    const hardWeapons = new Set(hardPool.filter((c) => c.topic === "weapon_kill").map((c) => c.params.weapon));
    expect(hardWeapons.has("ak47")).toBe(true);
    expect(hardWeapons.has("awp")).toBe(true);
  });

  it("drops the previous round's exact candidate", () => {
    const previousCandidate: Cs2Candidate = { topic: "survivors_round", params: { y: 2 } };
    const pool = eligibleCs2Candidates({ teams: TEAMS, roundNumber: 20, previousCandidate });
    expect(pool).not.toContainEqual(previousCandidate);
  });

  it("never returns an empty pool for any round 1-30", () => {
    for (let roundNumber = 1; roundNumber <= 30; roundNumber++) {
      const pool = eligibleCs2Candidates({ teams: TEAMS, roundNumber, previousCandidate: undefined });
      expect(pool.length).toBeGreaterThan(0);
      for (const candidate of pool) expect(buildCs2GeneralCandidates(TEAMS)).toContainEqual(candidate);
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
