import type {
  Cs2GameSnapshot,
  Cs2SettlementCondition,
  Cs2SettlementInvalidReason,
  Cs2SettlementResult,
  Cs2SettleFn,
  Cs2TeamId,
  Cs2TeamStats,
} from "@arena/contracts";

function teamStats(snapshot: Cs2GameSnapshot, teamId: Cs2TeamId): Cs2TeamStats | undefined {
  return snapshot.teams.find((team) => team.teamId === teamId);
}

function weaponKillCount(team: Cs2TeamStats, weapon: string): number {
  return team.weaponKills.find((w) => w.weaponName === weapon)?.count ?? 0;
}

/** Excludes players missing from the baseline rather than guessing through a feed roster change. */
function killDeltas(before: Cs2TeamStats, after: Cs2TeamStats): number[] {
  const beforeKills = new Map(before.players.map((p) => [p.id, p.kills]));
  return after.players
    .filter((p) => beforeKills.has(p.id))
    .map((p) => p.kills - (beforeKills.get(p.id) ?? p.kills));
}

function settled(condition: boolean): Cs2SettlementResult {
  return { status: "settled", answer: condition ? "yes" : "no" };
}

function invalid(reason: Cs2SettlementInvalidReason): Cs2SettlementResult {
  return { status: "invalid", reason };
}

function haveSameTeamIdentities(before: Cs2GameSnapshot, after: Cs2GameSnapshot): boolean {
  const beforeIds = new Set(before.teams.map((team) => team.teamId));
  const afterIds = new Set(after.teams.map((team) => team.teamId));
  return beforeIds.size === 2 && afterIds.size === 2 && after.teams.every((team) => beforeIds.has(team.teamId));
}

function targetedTeams(
  before: Cs2GameSnapshot,
  after: Cs2GameSnapshot,
  targetTeamId: Cs2TeamId | undefined,
): readonly [Cs2TeamStats, Cs2TeamStats] | undefined {
  if (targetTeamId === undefined) return undefined;
  const beforeTeam = teamStats(before, targetTeamId);
  const afterTeam = teamStats(after, targetTeamId);
  return beforeTeam === undefined || afterTeam === undefined ? undefined : [beforeTeam, afterTeam];
}

export const resolveCs2Settlement: Cs2SettleFn = (
  condition: Cs2SettlementCondition,
  before: Cs2GameSnapshot,
  after: Cs2GameSnapshot,
): Cs2SettlementResult => {
  if (!haveSameTeamIdentities(before, after)) return invalid("team_identity_mismatch");

  const { topic, params } = condition;
  switch (topic) {
    case "round_winner":
    case "pistol_round": {
      if (params.targetTeamId === undefined) return invalid("invalid_condition");
      const teams = targetedTeams(before, after, params.targetTeamId);
      if (teams === undefined) return invalid("unknown_team_id");
      return settled(teams[1].score > teams[0].score);
    }

    case "weapon_kill": {
      if (params.weapon === undefined) return invalid("invalid_condition");
      const beforeCount = weaponKillCount(before.teams[0], params.weapon) + weaponKillCount(before.teams[1], params.weapon);
      const afterCount = weaponKillCount(after.teams[0], params.weapon) + weaponKillCount(after.teams[1], params.weapon);
      return settled(afterCount > beforeCount);
    }

    case "team_ace": {
      if (params.targetTeamId === undefined) return invalid("invalid_condition");
      const teams = targetedTeams(before, after, params.targetTeamId);
      if (teams === undefined) return invalid("unknown_team_id");
      const deltas = killDeltas(...teams);
      return settled(deltas.length === 5 && deltas.every((d) => d === 1));
    }

    case "multikill": {
      if (params.targetTeamId === undefined || params.y === undefined) return invalid("invalid_condition");
      const teams = targetedTeams(before, after, params.targetTeamId);
      if (teams === undefined) return invalid("unknown_team_id");
      const deltas = killDeltas(...teams);
      const max = deltas.length > 0 ? Math.max(...deltas) : 0;
      return settled(max >= params.y);
    }

    case "survivors_team": {
      if (params.targetTeamId === undefined || params.y === undefined) return invalid("invalid_condition");
      const teams = targetedTeams(before, after, params.targetTeamId);
      if (teams === undefined) return invalid("unknown_team_id");
      const [beforeTeam, afterTeam] = teams;
      const survivors = 5 - (afterTeam.deaths - beforeTeam.deaths);
      return settled(survivors > params.y);
    }

    case "survivors_round": {
      if (params.y === undefined) return invalid("invalid_condition");
      const deathsDiff =
        after.teams[0].deaths - before.teams[0].deaths + (after.teams[1].deaths - before.teams[1].deaths);
      const survivors = 10 - deathsDiff;
      return settled(survivors > params.y);
    }

    case "ot_score": {
      return settled(after.teams[0].score === 12 && after.teams[1].score === 12);
    }
  }
};
