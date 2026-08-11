// CS2 question catalog (cs2-migration-spec/spec_v2.md §7 п.7): pure data + rendering, CS2's
// analog of question-generator/candidates.ts + templates.ts. `pickCs2Candidate` is a uniform
// random pick for now — §10's difficulty-weighted selection is a documented placeholder, same
// status as soccer's candidate picker today.
//
// `pistol_round` and `ot_score` (spec §7 п.4-5) are deliberately excluded from the random pool:
// they're fixed to specific Round numbers (13 and 24) by the round engine, not chosen here.
// This module still knows how to render/settle them so that logic isn't duplicated once the
// round engine (a later step) wires them in.

import { CS2_WEAPON_WHITELIST } from "@arena/contracts";
import type { Cs2SettlementCondition, Cs2Topic, Cs2TopicParams, Cs2Weapon, TeamSide } from "@arena/contracts";

export interface Cs2Candidate {
  topic: Cs2Topic;
  params: Cs2TopicParams;
}

/** "any" isn't a meaningful target for these questions — every general-catalog topic names a side. */
const CANDIDATE_TEAM_SIDES: readonly TeamSide[] = ["home", "away"];
const MULTIKILL_Y = [2, 3, 4, 5];
const SURVIVORS_TEAM_Y = [0, 1, 2, 3, 4];
const SURVIVORS_ROUND_Y = [0, 1, 2, 3, 4, 5];

/** Every (topic, params) combination from spec §7 п.7's 6-topic table — the random-pick pool. */
const GENERAL_CANDIDATES: readonly Cs2Candidate[] = [
  ...CANDIDATE_TEAM_SIDES.map((targetTeam): Cs2Candidate => ({ topic: "round_winner", params: { targetTeam } })),
  ...CS2_WEAPON_WHITELIST.map((weapon): Cs2Candidate => ({ topic: "weapon_kill", params: { weapon } })),
  ...CANDIDATE_TEAM_SIDES.map((targetTeam): Cs2Candidate => ({ topic: "team_ace", params: { targetTeam } })),
  ...CANDIDATE_TEAM_SIDES.flatMap((targetTeam) =>
    MULTIKILL_Y.map((y): Cs2Candidate => ({ topic: "multikill", params: { targetTeam, y } })),
  ),
  ...CANDIDATE_TEAM_SIDES.flatMap((targetTeam) =>
    SURVIVORS_TEAM_Y.map((y): Cs2Candidate => ({ topic: "survivors_team", params: { targetTeam, y } })),
  ),
  ...SURVIVORS_ROUND_Y.map((y): Cs2Candidate => ({ topic: "survivors_round", params: { y } })),
];

/** The full random-pick pool — exported for tests; every entry is a valid `pickCs2Candidate` result. */
export const CS2_GENERAL_CANDIDATES: readonly Cs2Candidate[] = GENERAL_CANDIDATES;

/** Uniformly random pick from the general catalog (spec §7 п.7). §10's weighting is deferred. */
export function pickCs2Candidate(): Cs2Candidate {
  const index = Math.floor(Math.random() * GENERAL_CANDIDATES.length);
  return GENERAL_CANDIDATES[index]!;
}

function teamLabel(team: TeamSide, teamNames?: { home: string; away: string }): string {
  if (team === "home") return teamNames?.home ?? "Home";
  if (team === "away") return teamNames?.away ?? "Away";
  return team;
}

function requireTeam(params: Cs2TopicParams, topic: Cs2Topic): TeamSide {
  if (params.targetTeam === undefined) throw new Error(`cs2 catalog: topic "${topic}" requires params.targetTeam`);
  return params.targetTeam;
}

function requireWeapon(params: Cs2TopicParams): Cs2Weapon {
  if (params.weapon === undefined) throw new Error(`cs2 catalog: topic "weapon_kill" requires params.weapon`);
  return params.weapon;
}

function requireY(params: Cs2TopicParams, topic: Cs2Topic): number {
  if (params.y === undefined) throw new Error(`cs2 catalog: topic "${topic}" requires params.y`);
  return params.y;
}

/** Renders the natural-language question text for a (topic, params) pair (spec §7 п.7/п.4/п.5). */
export function renderCs2Question(
  topic: Cs2Topic,
  params: Cs2TopicParams,
  teamNames?: { home: string; away: string },
): string {
  switch (topic) {
    case "round_winner":
      return `Will Team ${teamLabel(requireTeam(params, topic), teamNames)} win this round?`;
    case "weapon_kill":
      return `Will there be a kill with ${requireWeapon(params)} this round?`;
    case "team_ace":
      return `Will every player on Team ${teamLabel(requireTeam(params, topic), teamNames)} get a kill this round?`;
    case "multikill":
      return `Will Team ${teamLabel(requireTeam(params, topic), teamNames)} get a ${requireY(params, topic)}-kill this round?`;
    case "survivors_team":
      return `Will Team ${teamLabel(requireTeam(params, topic), teamNames)} have more than ${requireY(params, topic)} survivors this round?`;
    case "survivors_round":
      return `Will more than ${requireY(params, topic)} players survive this round in total?`;
    case "pistol_round":
      return `Will Team ${teamLabel(requireTeam(params, topic), teamNames)} win the pistol round?`;
    case "ot_score":
      return "Will the score be 12-12 after this round?";
  }
}

/** Bundles a (topic, params) pick into the full settlement condition attached to a PredictionRound. */
export function buildCs2SettlementCondition(
  topic: Cs2Topic,
  params: Cs2TopicParams,
  roundNumber: number,
): Cs2SettlementCondition {
  return { discipline: "cs2", topic, params, roundNumber, resolve: "snapshot_diff" };
}
