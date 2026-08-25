import { CS2_WEAPON_WHITELIST } from "@arena/contracts";
import type { Cs2SettlementCondition, Cs2Topic, Cs2TopicParams, Cs2Weapon, TeamSide } from "@arena/contracts";

export interface Cs2Candidate {
  topic: Cs2Topic;
  params: Cs2TopicParams;
}

const CANDIDATE_TEAM_SIDES: readonly TeamSide[] = ["home", "away"];
const MULTIKILL_Y = [2, 3, 4, 5];
const SURVIVORS_TEAM_Y = [0, 1, 2, 3, 4];
const SURVIVORS_ROUND_Y = [0, 1, 2, 3, 4, 5];

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

export const CS2_GENERAL_CANDIDATES: readonly Cs2Candidate[] = GENERAL_CANDIDATES;

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

export function buildCs2SettlementCondition(
  topic: Cs2Topic,
  params: Cs2TopicParams,
  roundNumber: number,
): Cs2SettlementCondition {
  return { discipline: "cs2", topic, params, roundNumber, resolve: "snapshot_diff" };
}
