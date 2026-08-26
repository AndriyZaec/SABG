import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot } from "@arena/contracts";
import { resolveCs2Settlement } from "../settle.js";
import { buildCs2SettlementCondition } from "../catalog.js";
import { parseSnapshot } from "../snapshot.js";
import { defaultCs2FixturePath, loadCs2Fixture } from "../fixture.js";

function team(teamId: string, overrides: Partial<Cs2GameSnapshot["teams"][0]> = {}) {
  return { teamId, name: teamId, score: 0, deaths: 0, weaponKills: [], players: [], ...overrides };
}

function teams(
  first: Partial<Cs2GameSnapshot["teams"][0]> = {},
  second: Partial<Cs2GameSnapshot["teams"][0]> = {},
): Cs2GameSnapshot["teams"] {
  return [team("team-a", first), team("team-b", second)];
}

function settlementAnswer(...args: Parameters<typeof resolveCs2Settlement>) {
  const result = resolveCs2Settlement(...args);
  expect(result.status).toBe("settled");
  return result.status === "settled" ? result.answer : undefined;
}

const DEFAULT_CLOCK: Cs2GameSnapshot["clock"] = { ticking: true, currentSeconds: 60 };

describe("resolveCs2Settlement — synthetic cases", () => {
  it("round_winner: yes for the team whose score increased, no for the other", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 3 }, { score: 2 }) };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 4 }, { score: 2 }) };
    expect(settlementAnswer(buildCs2SettlementCondition("round_winner", { targetTeamId: "team-a" }, 4), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("round_winner", { targetTeamId: "team-b" }, 4), before, after)).toBe("no");
  });

  it("pistol_round: same math as round_winner", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams() };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({}, { score: 1 }) };
    expect(settlementAnswer(buildCs2SettlementCondition("pistol_round", { targetTeamId: "team-b" }, 13), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("pistol_round", { targetTeamId: "team-a" }, 13), before, after)).toBe("no");
  });

  it("weapon_kill: yes iff the whitelisted weapon's combined count grew", () => {
    const before: Cs2GameSnapshot = {
      clock: DEFAULT_CLOCK,
      teams: teams({ weaponKills: [{ weaponName: "awp", count: 1 }] }, { weaponKills: [{ weaponName: "awp", count: 0 }] }),
    };
    const after: Cs2GameSnapshot = {
      clock: DEFAULT_CLOCK,
      teams: teams({ weaponKills: [{ weaponName: "awp", count: 1 }] }, { weaponKills: [{ weaponName: "awp", count: 1 }] }),
    };
    expect(settlementAnswer(buildCs2SettlementCondition("weapon_kill", { weapon: "awp" }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("weapon_kill", { weapon: "ak47" }, 1), before, after)).toBe("no");
  });

  it("team_ace: yes only when all 5 players each got exactly one kill", () => {
    const players5 = (kills: number[]) => kills.map((k, i) => ({ id: `p${i}`, kills: k }));
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ players: players5([0, 0, 0, 0, 0]) }) };
    const aceAfter: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ players: players5([1, 1, 1, 1, 1]) }) };
    const notAceAfter: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ players: players5([2, 1, 1, 1, 0]) }) };
    expect(settlementAnswer(buildCs2SettlementCondition("team_ace", { targetTeamId: "team-a" }, 1), before, aceAfter)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("team_ace", { targetTeamId: "team-a" }, 1), before, notAceAfter)).toBe("no");
  });

  it("multikill: yes iff the team's best per-player delta reaches y", () => {
    const players5 = (kills: number[]) => kills.map((k, i) => ({ id: `p${i}`, kills: k }));
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ players: players5([0, 0, 0, 0, 0]) }) };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ players: players5([3, 1, 0, 0, 0]) }) };
    expect(settlementAnswer(buildCs2SettlementCondition("multikill", { targetTeamId: "team-a", y: 3 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("multikill", { targetTeamId: "team-a", y: 4 }, 1), before, after)).toBe("no");
  });

  it("survivors_team: yes iff 5 - deaths_diff > y", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams() };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ deaths: 2 }) };
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_team", { targetTeamId: "team-a", y: 2 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_team", { targetTeamId: "team-a", y: 3 }, 1), before, after)).toBe("no");
  });

  it("survivors_round: yes iff 10 - total_deaths_diff > y", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams() };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ deaths: 2 }, { deaths: 5 }) };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("survivors_round", {}, 1), before, after)).toEqual({ status: "invalid", reason: "invalid_condition" });
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_round", { y: 2 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_round", { y: 3 }, 1), before, after)).toBe("no");
  });

  it("ot_score: yes only for an exact 12-12 after-snapshot, no otherwise — reads `after` directly, not a diff", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 99 }, { score: 99 }) };
    const tied: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 12 }, { score: 12 }) };
    const clinched: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 12 }, { score: 13 }) };
    expect(settlementAnswer(buildCs2SettlementCondition("ot_score", {}, 24), before, tied)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("ot_score", {}, 24), before, clinched)).toBe("no");
  });

  it("returns invalid for an unknown target or changed team identities", () => {
    const before: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams() };
    const after: Cs2GameSnapshot = { clock: DEFAULT_CLOCK, teams: teams({ score: 1 }) };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeamId: "missing" }, 1), before, after)).toEqual({ status: "invalid", reason: "unknown_team_id" });

    const changed: Cs2GameSnapshot = {
      clock: DEFAULT_CLOCK,
      teams: [team("team-a", { score: 1 }), team("team-c")],
    };
    expect(resolveCs2Settlement(buildCs2SettlementCondition("round_winner", { targetTeamId: "team-a" }, 1), before, changed)).toEqual({ status: "invalid", reason: "team_identity_mismatch" });
  });
});

describe("resolveCs2Settlement — Round 1 of the recorded fixture (cs2_series_28)", () => {
  // Fixture boundary: round 1 lock baseline to the first 1-0 snapshot.
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  const before = parseSnapshot(entries[0]!.raw)!;
  const after = parseSnapshot(entries[18]!.raw)!;

  it("round_winner resolves each team by identity", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("round_winner", { targetTeamId: before.teams[0].teamId }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("round_winner", { targetTeamId: before.teams[1].teamId }, 1), before, after)).toBe("no");
  });

  it("weapon_kill: usp_silencer and glock were used, awp was not", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("weapon_kill", { weapon: "usp_silencer" }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("weapon_kill", { weapon: "glock" }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("weapon_kill", { weapon: "awp" }, 1), before, after)).toBe("no");
  });

  it("team_ace: neither team's kills were an even 1-each split", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("team_ace", { targetTeamId: before.teams[0].teamId }, 1), before, after)).toBe("no");
    expect(settlementAnswer(buildCs2SettlementCondition("team_ace", { targetTeamId: before.teams[1].teamId }, 1), before, after)).toBe("no");
  });

  it("multikill resolves each team by identity", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("multikill", { targetTeamId: before.teams[0].teamId, y: 2 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("multikill", { targetTeamId: before.teams[0].teamId, y: 3 }, 1), before, after)).toBe("no");
    expect(settlementAnswer(buildCs2SettlementCondition("multikill", { targetTeamId: before.teams[1].teamId, y: 2 }, 1), before, after)).toBe("no");
  });

  it("survivors_team resolves each team by identity", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_team", { targetTeamId: before.teams[0].teamId, y: 2 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_team", { targetTeamId: before.teams[0].teamId, y: 3 }, 1), before, after)).toBe("no");
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_team", { targetTeamId: before.teams[1].teamId, y: 0 }, 1), before, after)).toBe("no");
  });

  it("survivors_round: 7 total deaths -> 3 survivors", () => {
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_round", { y: 2 }, 1), before, after)).toBe("yes");
    expect(settlementAnswer(buildCs2SettlementCondition("survivors_round", { y: 3 }, 1), before, after)).toBe("no");
  });
});

describe("resolveCs2Settlement — Round 24 boundary (12-12 vs one side clinched) from the recorded fixture", () => {
  const entries = loadCs2Fixture(defaultCs2FixturePath());
  const before = parseSnapshot(entries[0]!.raw)!;

  it("reads 12-12 as yes", () => {
    const tied = parseSnapshot(entries[246]!.raw)!;
    expect(settlementAnswer(buildCs2SettlementCondition("ot_score", {}, 24), before, tied)).toBe("yes");
  });

  it("reads 12-13 as no", () => {
    const clinched = parseSnapshot(entries[269]!.raw)!;
    expect(settlementAnswer(buildCs2SettlementCondition("ot_score", {}, 24), before, clinched)).toBe("no");
  });
});
