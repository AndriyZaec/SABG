import { describe, expect, it } from "vitest";
import {
  cs2Difficulty,
  cs2TierForRound,
  isCs2PistolRound,
  isEconomyBanned,
} from "../weights.js";
import type { Cs2Candidate } from "../catalog.js";

describe("cs2TierForRound", () => {
  it("bands rounds into easy/medium/hard at the R5/R6 and R14/R15 boundaries", () => {
    expect(cs2TierForRound(5)).toBe("easy");
    expect(cs2TierForRound(6)).toBe("medium");
    expect(cs2TierForRound(14)).toBe("medium");
    expect(cs2TierForRound(15)).toBe("hard");
    expect(cs2TierForRound(30)).toBe("hard");
  });
});

describe("isCs2PistolRound", () => {
  it("is true only for rounds 1 and 13", () => {
    expect(isCs2PistolRound(1)).toBe(true);
    expect(isCs2PistolRound(13)).toBe(true);
    expect(isCs2PistolRound(2)).toBe(false);
    expect(isCs2PistolRound(14)).toBe(false);
  });
});

describe("isEconomyBanned", () => {
  it("bans ak47/awp/molotov/hegrenade on rounds 1, 2, 13, 14 and not elsewhere", () => {
    const ak47: Cs2Candidate = { topic: "weapon_kill", params: { weapon: "ak47" } };
    for (const roundNumber of [1, 2, 13, 14]) {
      expect(isEconomyBanned(ak47, roundNumber)).toBe(true);
    }
    expect(isEconomyBanned(ak47, 3)).toBe(false);
  });

  it("never bans pistols or non-catalog topics", () => {
    const glock: Cs2Candidate = { topic: "weapon_kill", params: { weapon: "glock" } };
    expect(isEconomyBanned(glock, 1)).toBe(false);
    const roundWinner: Cs2Candidate = { topic: "round_winner", params: { targetTeamId: "team-a" } };
    expect(isEconomyBanned(roundWinner, 1)).toBe(false);
  });
});

describe("cs2Difficulty", () => {
  it("returns undefined for flat-pool topics", () => {
    expect(cs2Difficulty({ topic: "round_winner", params: { targetTeamId: "team-a" } }, false, 0)).toBeUndefined();
    expect(cs2Difficulty({ topic: "survivors_team", params: { targetTeamId: "team-b", y: 2 } }, false, 1)).toBeUndefined();
  });

  it("returns undefined for team-scoped topics when the team slot is unknown", () => {
    const teamAce: Cs2Candidate = { topic: "team_ace", params: { targetTeamId: "team-a" } };
    expect(cs2Difficulty(teamAce, false, undefined)).toBeUndefined();
  });

  it("returns a different value for glock/usp_silencer depending on round type", () => {
    const glock: Cs2Candidate = { topic: "weapon_kill", params: { weapon: "glock" } };
    const pistol = cs2Difficulty(glock, true, undefined);
    const nonPistol = cs2Difficulty(glock, false, undefined);
    expect(pistol).toBeDefined();
    expect(nonPistol).toBeDefined();
    expect(pistol).not.toBe(nonPistol);
  });

  it("is unaffected by round type for non-conditional topics", () => {
    const ak47: Cs2Candidate = { topic: "weapon_kill", params: { weapon: "ak47" } };
    expect(cs2Difficulty(ak47, true, undefined)).toBe(cs2Difficulty(ak47, false, undefined));
  });

  it("returns different values for team slot 0 vs 1 on team_ace", () => {
    const teamAce: Cs2Candidate = { topic: "team_ace", params: { targetTeamId: "team-a" } };
    expect(cs2Difficulty(teamAce, false, 0)).not.toBe(cs2Difficulty(teamAce, false, 1));
  });
});
