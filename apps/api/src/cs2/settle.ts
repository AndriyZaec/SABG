// CS2 Settlement core: the pure, idempotent settlement function (spec §7 п.7, §10 "diff of two
// snapshots"). CS2's analog of settlement/resolve.ts — no I/O, no clock, just `(condition,
// before, after) => Answer` reading the round's before/after `Cs2GameSnapshot`s (before = "at
// lock" baseline — the round-tracker's first-seen snapshot for the round, round-tracker.ts;
// after = the snapshot that first showed the round's score change).
//
// Index convention: `teams[0]` is `"home"`, `teams[1]` is `"away"`. GRID has no inherent
// home/away concept (it's just an ordered pair) — a later step decides the real mapping when a
// CS2 Match row is created; this module only needs *a* stable, documented convention to resolve
// `targetTeam`.

import type { Answer, Cs2GameSnapshot, Cs2SettlementCondition, Cs2SettleFn, Cs2TeamStats, TeamSide } from "@arena/contracts";

function teamStats(snapshot: Cs2GameSnapshot, team: TeamSide): Cs2TeamStats {
  const [home, away] = snapshot.teams;
  return team === "away" ? away : home; // "any" isn't a valid target for any CS2 topic — treated as home
}

function weaponKillCount(team: Cs2TeamStats, weapon: string): number {
  return team.weaponKills.find((w) => w.weaponName === weapon)?.count ?? 0;
}

/** Per-player kill deltas for one team, matched by player id. A player missing from `before`
 *  (roster mismatch — shouldn't happen mid-map, but the feed is never assumed reliable) is
 *  excluded rather than guessed at. */
function killDeltas(before: Cs2TeamStats, after: Cs2TeamStats): number[] {
  const beforeKills = new Map(before.players.map((p) => [p.id, p.kills]));
  return after.players
    .filter((p) => beforeKills.has(p.id))
    .map((p) => p.kills - (beforeKills.get(p.id) ?? p.kills));
}

function answer(condition: boolean): Answer {
  return condition ? "yes" : "no";
}

/** Round winner: whichever team's `score` increased between the two snapshots (spec §7 п.7,
 *  п.4 — `pistol_round` reuses this exact check, it's just fixed to Round 13 by the caller). */
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
      if (params.targetTeam === undefined) return "no"; // malformed condition — never crash settlement
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
      // Direct read of `after` — not a diff (spec §7 п.5): 12-12 means OT is needed, anything
      // else (one team already at 13, or any other combination) settles "no".
      return answer(after.teams[0].score === 12 && after.teams[1].score === 12);
    }
  }
};
