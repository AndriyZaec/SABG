import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot } from "@arena/contracts";
import { resolveCs2Settlement } from "../settle.js";
import { buildCs2SettlementCondition } from "../catalog.js";
import { parseSnapshot } from "../snapshot.js";
import { defaultCs2FixturePath, loadCs2Fixture } from "../fixture.js";

function team(overrides: Partial<Cs2GameSnapshot["teams"][0]> = {}) {
  return { name: "T", score: 0, deaths: 0, weaponKills: [], players: [], ...overrides };
}

const DEFAULT_CLOCK: Cs2GameSnapshot["clock"] = { ticking: true, currentSeconds: 60 };

describe("resolveCs2Settlement — synthetic cases", () => {
  it("round_winner: yes for the team whose score increased, no for the other", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 3 }), team({ score: 2 })] };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 4 }), team({ score: 2 })] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeam: "home" }, 4), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeam: "away" }, 4), before, after)).toBe("no");
  });

  it("pistol_round: same math as round_winner", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 0 }), team({ score: 0 })] };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 0 }), team({ score: 1 })] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("pistol_round", { targetTeam: "away" }, 13), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("pistol_round", { targetTeam: "home" }, 13), before, after)).toBe("no");
  });

  it("weapon_kill: yes iff the whitelisted weapon's combined count grew", () => {
    const before: Cs2GameSnapshot = {
      clock: DEFAULT_CLOCK,
      teams: [team({ weaponKills: [{ weaponName: "awp", count: 1 }] }), team({ weaponKills: [{ weaponName: "awp", count: 0 }] })],
    };
    const after: Cs2GameSnapshot = {
      clock: DEFAULT_CLOCK,
      teams: [team({ weaponKills: [{ weaponName: "awp", count: 1 }] }), team({ weaponKills: [{ weaponName: "awp", count: 1 }] })],
    };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("weapon_kill", { weapon: "awp" }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("weapon_kill", { weapon: "ak47" }, 1), before, after)).toBe("no");
  });

  it("team_ace: yes only when all 5 players each got exactly one kill", () => {
    const players5 = (kills: number[]) => kills.map((k, i) => ({ id: `p${i}`, kills: k }));
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ players: players5([0, 0, 0, 0, 0]) }), team()] };
    const aceAfter: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ players: players5([1, 1, 1, 1, 1]) }), team()] };
    const notAceAfter: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ players: players5([2, 1, 1, 1, 0]) }), team()] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("team_ace", { targetTeam: "home" }, 1), before, aceAfter)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("team_ace", { targetTeam: "home" }, 1), before, notAceAfter)).toBe("no");
  });

  it("multikill: yes iff the team's best per-player delta reaches y", () => {
    const players5 = (kills: number[]) => kills.map((k, i) => ({ id: `p${i}`, kills: k }));
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ players: players5([0, 0, 0, 0, 0]) }), team()] };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ players: players5([3, 1, 0, 0, 0]) }), team()] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("multikill", { targetTeam: "home", y: 3 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("multikill", { targetTeam: "home", y: 4 }, 1), before, after)).toBe("no");
  });

  it("survivors_team: yes iff 5 - deaths_diff > y", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ deaths: 0 }), team()] };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ deaths: 2 }), team()] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_team", { targetTeam: "home", y: 2 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_team", { targetTeam: "home", y: 3 }, 1), before, after)).toBe("no");
  });

  it("survivors_round: yes iff 10 - total_deaths_diff > y", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ deaths: 0 }), team({ deaths: 0 })] };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ deaths: 2 }), team({ deaths: 5 })] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", {}, 1), before, after)).toBe("no");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", { y: 2 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", { y: 3 }, 1), before, after)).toBe("no");
  });

  it("ot_score: yes only for an exact 12-12 after-snapshot, no otherwise — reads `after` directly, not a diff", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 99 }), team({ score: 99 })] };
    const tied: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 12 }), team({ score: 12 })] };
    const clinched: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: [team({ score: 12 }), team({ score: 13 })] };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("ot_score", {}, 24), before, tied)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("ot_score", {}, 24), before, clinched)).toBe("no");
  });
});

describe("resolveCs2Settlement — Round 1 of the recorded fixture (cs2_series_28)", () => {
  // Fixture boundary: round 1 lock baseline to the first 1-0 snapshot.
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  const before = parseSnapshot(entries[0]!.raw)!;
  const after = parseSnapshot(entries[18]!.raw)!;

  it("round_winner: home won, away did not", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeam: "home" }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeam: "away" }, 1), before, after)).toBe("no");
  });

  it("weapon_kill: usp_silencer and glock were used, awp was not", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("weapon_kill", { weapon: "usp_silencer" }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("weapon_kill", { weapon: "glock" }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("weapon_kill", { weapon: "awp" }, 1), before, after)).toBe("no");
  });

  it("team_ace: neither side's kills were an even 1-each split", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("team_ace", { targetTeam: "home" }, 1), before, after)).toBe("no");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("team_ace", { targetTeam: "away" }, 1), before, after)).toBe("no");
  });

  it("multikill: home's top fragger got exactly 2, away's got exactly 1", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("multikill", { targetTeam: "home", y: 2 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("multikill", { targetTeam: "home", y: 3 }, 1), before, after)).toBe("no");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("multikill", { targetTeam: "away", y: 2 }, 1), before, after)).toBe("no");
  });

  it("survivors_team: home lost 2 (3 survivors), away was wiped (0 survivors)", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_team", { targetTeam: "home", y: 2 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_team", { targetTeam: "home", y: 3 }, 1), before, after)).toBe("no");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_team", { targetTeam: "away", y: 0 }, 1), before, after)).toBe("no");
  });

  it("survivors_round: 7 total deaths -> 3 survivors", () => {
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", { y: 2 }, 1), before, after)).toBe("yes");
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", { y: 3 }, 1), before, after)).toBe("no");
  });
});

describe("resolveCs2Settlement — Round 24 boundary (12-12 vs one side clinched) from the recorded fixture", () => {
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  const before = parseSnapshot(entries[0]!.raw)!;

  it("reads 12-12 as yes", () => {
    const tied = parseSnapshot(entries[246]!.raw)!;
    expect(resolveCs2Settlement(buildCs2SettlementCondition("ot_score", {}, 24), before, tied)).toBe("yes");
  });

  it("reads 12-13 as no", () => {
    const clinched = parseSnapshot(entries[269]!.raw)!;
    expect(resolveCs2Settlement(buildCs2SettlementCondition("ot_score", {}, 24), before, clinched)).toBe("no");
  });
});
