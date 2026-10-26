import { CS2_WEAPON_LABELS, type Cs2TeamIdentity, type Cs2Topic, type Cs2TopicParams } from "./settlement.js";

function teamName(params: Cs2TopicParams, topic: Cs2Topic, teams: readonly Cs2TeamIdentity[]): string {
  if (params.targetTeamId === undefined) throw new Error(`cs2 question: topic "${topic}" requires params.targetTeamId`);
  const team = teams.find((candidate) => candidate.teamId === params.targetTeamId);
  if (team === undefined) throw new Error(`cs2 question: unknown targetTeamId "${params.targetTeamId}"`);
  return team.name;
}

function weaponLabel(params: Cs2TopicParams): string {
  if (params.weapon === undefined) throw new Error(`cs2 question: topic "weapon_kill" requires params.weapon`);
  return CS2_WEAPON_LABELS[params.weapon];
}

function threshold(params: Cs2TopicParams, topic: Cs2Topic): number {
  if (params.y === undefined) throw new Error(`cs2 question: topic "${topic}" requires params.y`);
  return params.y;
}

/** Compact form of a CS2 question for lists like the match feed; throws like the full form on bad params. */
export function renderCs2QuestionShort(
  topic: Cs2Topic,
  params: Cs2TopicParams,
  teams: readonly Cs2TeamIdentity[],
): string {
  switch (topic) {
    case "round_winner":
      return `${teamName(params, topic, teams)} win?`;
    case "weapon_kill":
      return `${weaponLabel(params)} kill?`;
    case "team_ace":
      return `${teamName(params, topic, teams)}: all 5 get a kill?`;
    case "multikill":
      return `${teamName(params, topic, teams)} player ${threshold(params, topic)} kills?`;
    case "survivors_team":
      return `${teamName(params, topic, teams)} > ${threshold(params, topic)} alive?`;
    case "survivors_round":
      return `> ${threshold(params, topic)} survive total?`;
    case "pistol_round":
      return `${teamName(params, topic, teams)} win pistol?`;
    case "ot_score":
      return "12-12 after round?";
  }
}
