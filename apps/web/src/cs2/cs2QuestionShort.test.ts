import { describe, expect, it } from "vitest";
import { renderCs2QuestionShort, type Cs2TeamIdentity } from "@arena/contracts";

const TEAMS: Cs2TeamIdentity[] = [
  { teamId: "t1", name: "Aurora YB" },
  { teamId: "t2", name: "Four Magic" },
];

describe("renderCs2QuestionShort", () => {
  it("renders every topic in its compact form", () => {
    expect(renderCs2QuestionShort("round_winner", { targetTeamId: "t1" }, TEAMS)).toBe("Aurora YB win?");
    expect(renderCs2QuestionShort("weapon_kill", { weapon: "tec9" }, TEAMS)).toBe("Tec-9 kill?");
    expect(renderCs2QuestionShort("team_ace", { targetTeamId: "t2" }, TEAMS)).toBe("Four Magic: all 5 get a kill?");
    expect(renderCs2QuestionShort("multikill", { targetTeamId: "t1", y: 5 }, TEAMS)).toBe("Aurora YB player 5 kills?");
    expect(renderCs2QuestionShort("survivors_team", { targetTeamId: "t2", y: 2 }, TEAMS)).toBe("Four Magic > 2 alive?");
    expect(renderCs2QuestionShort("survivors_round", { y: 4 }, TEAMS)).toBe("> 4 survive total?");
    expect(renderCs2QuestionShort("pistol_round", { targetTeamId: "t1" }, TEAMS)).toBe("Aurora YB win pistol?");
    expect(renderCs2QuestionShort("ot_score", {}, TEAMS)).toBe("12-12 after round?");
  });

  it("uses player-facing weapon names", () => {
    expect(renderCs2QuestionShort("weapon_kill", { weapon: "hegrenade" }, TEAMS)).toBe("HE grenade kill?");
    expect(renderCs2QuestionShort("weapon_kill", { weapon: "usp_silencer" }, TEAMS)).toBe("USP-S kill?");
    expect(renderCs2QuestionShort("weapon_kill", { weapon: "ak47" }, TEAMS)).toBe("AK-47 kill?");
  });

  it("throws on an unknown team, like the full question", () => {
    expect(() => renderCs2QuestionShort("round_winner", { targetTeamId: "missing" }, TEAMS)).toThrow(
      'unknown targetTeamId "missing"',
    );
  });
});
