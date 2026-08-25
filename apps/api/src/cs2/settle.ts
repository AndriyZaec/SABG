// GRID supplies an ordered team pair, interpreted consistently as home then away.

import type { Answer, Cs2GameSnapshot, Cs2SettlementCondition, Cs2SettleFn, Cs2TeamStats, TeamSide } from "@arena/contracts";

function teamStats(snapshot: Cs2GameSnapshot, team: TeamSide): Cs2TeamStats {
  const [home, away] = snapshot.teams;
  return team === "away" ? away : home;
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

function answer(condition: boolean): Answer {
  return condition ? "yes" : "no";
}

function roundWinnerAnswer(snapshotBefore: Cs2GameSnapshot, snapshotAfter: Cs2GameSnapshot, targetTeam: TeamSide): Answer {
  const before = teamStats(snapshotBefore, targetTeam);
  const after = teamStats(snapshotAfter, targetTeam);
  return answer(after.score > before.score);
}

export const resolveCs2Settlement: Cs2SettleFn = (
  condition: Cs2SettlementCondition,
  before: Cs2GameSnapshot,
  after: Cs2GameSnapshot,
): Answer => {
  const { topic, params } = condition;
  switch (topic) {
    case "round_winner":
    case "pistol_round": {
      if (params.targetTeam === undefined) return "no";
      return roundWinnerAnswer(before, after, params.targetTeam);
    }

    case "weapon_kill": {
      if (params.weapon === undefined) return "no";
      const beforeCount = weaponKillCount(before.teams[0], params.weapon) + weaponKillCount(before.teams[1], params.weapon);
      const afterCount = weaponKillCount(after.teams[0], params.weapon) + weaponKillCount(after.teams[1], params.weapon);
      return answer(afterCount > beforeCount);
    }

    case "team_ace": {
      if (params.targetTeam === undefined) return "no";
      const deltas = killDeltas(teamStats(before, params.targetTeam), teamStats(after, params.targetTeam));
      return answer(deltas.length === 5 && deltas.every((d) => d === 1));
    }

    case "multikill": {
      if (params.targetTeam === undefined || params.y === undefined) return "no";
      const deltas = killDeltas(teamStats(before, params.targetTeam), teamStats(after, params.targetTeam));
      const max = deltas.length > 0 ? Math.max(...deltas) : 0;
      return answer(max >= params.y);
    }

    case "survivors_team": {
      if (params.targetTeam === undefined || params.y === undefined) return "no";
      const beforeTeam = teamStats(before, params.targetTeam);
      const afterTeam = teamStats(after, params.targetTeam);
      const survivors = 5 - (afterTeam.deaths - beforeTeam.deaths);
      return answer(survivors > params.y);
    }

    case "survivors_round": {
      if (params.y === undefined) return "no";
      const deathsDiff =
        after.teams[0].deaths - before.teams[0].deaths + (after.teams[1].deaths - before.teams[1].deaths);
      const survivors = 10 - deathsDiff;
      return answer(survivors > params.y);
    }

    case "ot_score": {
      // Overtime depends on the resulting score, not a stat delta.
      return answer(after.teams[0].score === 12 && after.teams[1].score === 12);
    }
  }
};
