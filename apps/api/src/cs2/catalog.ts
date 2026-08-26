import { CS2_WEAPON_WHITELIST } from "@arena/contracts";
import type {
  Cs2SettlementCondition,
  Cs2TeamIdentity,
  Cs2TeamId,
  Cs2Topic,
  Cs2TopicParams,
  Cs2Weapon,
} from "@arena/contracts";
import {
  cs2Difficulty,
  cs2TierForRound,
  cs2TierMatches,
  isCs2PistolRound,
  isEconomyBanned,
  isPistolConditionalWeapon,
  type Cs2TeamSlot,
} from "./weights.js";

export interface Cs2Candidate {
  topic: Cs2Topic;
  params: Cs2TopicParams;
}

const MULTIKILL_Y = [2, 3, 4, 5];
const SURVIVORS_TEAM_Y = [0, 1, 2, 3, 4];
const SURVIVORS_ROUND_Y = [0, 1, 2, 3, 4, 5];

export function buildCs2GeneralCandidates(teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity]): Cs2Candidate[] {
  const teamIds = teams.map((team) => team.teamId);
  return [
    ...teamIds.map((targetTeamId): Cs2Candidate => ({ topic: "round_winner", params: { targetTeamId } })),
    ...CS2_WEAPON_WHITELIST.map((weapon): Cs2Candidate => ({ topic: "weapon_kill", params: { weapon } })),
    ...teamIds.map((targetTeamId): Cs2Candidate => ({ topic: "team_ace", params: { targetTeamId } })),
    ...teamIds.flatMap((targetTeamId) =>
      MULTIKILL_Y.map((y): Cs2Candidate => ({ topic: "multikill", params: { targetTeamId, y } })),
    ),
    ...teamIds.flatMap((targetTeamId) =>
      SURVIVORS_TEAM_Y.map((y): Cs2Candidate => ({ topic: "survivors_team", params: { targetTeamId, y } })),
    ),
    ...SURVIVORS_ROUND_Y.map((y): Cs2Candidate => ({ topic: "survivors_round", params: { y } })),
  ];
}

export interface Cs2CandidatePickInput {
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity];
  roundNumber: number;
  previousCandidate: Cs2Candidate | undefined;
}

function sameCandidate(a: Cs2Candidate, b: Cs2Candidate): boolean {
  return (
    a.topic === b.topic &&
    a.params.targetTeamId === b.params.targetTeamId &&
    a.params.weapon === b.params.weapon &&
    a.params.y === b.params.y
  );
}

function teamSlotOf(
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity],
  targetTeamId: Cs2TeamId | undefined,
): Cs2TeamSlot | undefined {
  if (targetTeamId === undefined) return undefined;
  return teams[0].teamId === targetTeamId ? 0 : teams[1].teamId === targetTeamId ? 1 : undefined;
}

export function eligibleCs2Candidates(input: Cs2CandidatePickInput): Cs2Candidate[] {
  const { teams, roundNumber, previousCandidate } = input;
  const isPistolRound = isCs2PistolRound(roundNumber);
  const tier = cs2TierForRound(roundNumber);
  const generalCandidates = buildCs2GeneralCandidates(teams);

  const nonBanned = generalCandidates.filter((c) => !isEconomyBanned(c, roundNumber));
  const tierPool = nonBanned.filter((c) => {
    // Pistol economy makes glock/usp_silencer kills near-certain on R1/13 regardless of that round's usual tier.
    if (isPistolRound && c.topic === "weapon_kill" && c.params.weapon !== undefined && isPistolConditionalWeapon(c.params.weapon)) {
      return true;
    }
    const difficulty = cs2Difficulty(c, isPistolRound, teamSlotOf(teams, c.params.targetTeamId));
    if (difficulty === undefined) return tier !== "easy";
    return cs2TierMatches(tier, difficulty);
  });

  const varied = previousCandidate === undefined ? tierPool : tierPool.filter((c) => !sameCandidate(c, previousCandidate));
  if (varied.length > 0) return varied;
  if (tierPool.length > 0) return tierPool;
  return nonBanned.length > 0 ? nonBanned : generalCandidates;
}

export function pickCs2Candidate(input: Cs2CandidatePickInput): Cs2Candidate {
  const pool = eligibleCs2Candidates(input);
  const index = Math.floor(Math.random() * pool.length);
  return pool[index]!;
}

function requireTeamId(params: Cs2TopicParams, topic: Cs2Topic): Cs2TeamId {
  if (params.targetTeamId === undefined) {
    throw new Error(`cs2 catalog: topic "${topic}" requires params.targetTeamId`);
  }
  return params.targetTeamId;
}

function teamName(
  params: Cs2TopicParams,
  topic: Cs2Topic,
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity],
): string {
  const teamId = requireTeamId(params, topic);
  const team = teams.find((candidate) => candidate.teamId === teamId);
  if (team === undefined) throw new Error(`cs2 catalog: unknown targetTeamId "${teamId}"`);
  return team.name;
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
  teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity],
): string {
  switch (topic) {
    case "round_winner":
      return `Will Team ${teamName(params, topic, teams)} win this round?`;
    case "weapon_kill":
      return `Will there be a kill with ${requireWeapon(params)} this round?`;
    case "team_ace":
      return `Will every player on Team ${teamName(params, topic, teams)} get a kill this round?`;
    case "multikill":
      return `Will Team ${teamName(params, topic, teams)} get a ${requireY(params, topic)}-kill this round?`;
    case "survivors_team":
      return `Will Team ${teamName(params, topic, teams)} have more than ${requireY(params, topic)} survivors this round?`;
    case "survivors_round":
      return `Will more than ${requireY(params, topic)} players survive this round in total?`;
    case "pistol_round":
      return `Will Team ${teamName(params, topic, teams)} win the pistol round?`;
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
