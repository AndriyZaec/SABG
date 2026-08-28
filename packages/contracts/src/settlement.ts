import type { TargetEventType, TeamSide, Answer } from "./enums.js";

export interface SoccerSettlementCondition {
  discipline: "soccer";
  targetEventType: TargetEventType;
  targetTeam: TeamSide;
  windowStartMinute: number;
  windowEndMinute: number;
  resolve: "event_in_window";
}

export const CS2_TOPICS = [
  "round_winner",
  "weapon_kill",
  "team_ace",
  "multikill",
  "survivors_team",
  "survivors_round",
  "pistol_round",
  "ot_score",
] as const;
export type Cs2Topic = (typeof CS2_TOPICS)[number];

export const CS2_WEAPON_WHITELIST = [
  "awp",
  "ak47",
  "usp_silencer",
  "deagle",
  "molotov",
  "glock",
  "tec9",
  "hegrenade",
] as const;
export type Cs2Weapon = (typeof CS2_WEAPON_WHITELIST)[number];

export type Cs2TeamId = string;

export interface Cs2TeamIdentity {
  teamId: Cs2TeamId;
  name: string;
}

export interface Cs2TopicParams {
  /** Present only for team-targeted topics. */
  targetTeamId?: Cs2TeamId;
  /** Present only for weapon-kill topics. */
  weapon?: Cs2Weapon;
  /** Present only for threshold-based topics. */
  y?: number;
}

export interface Cs2SettlementCondition {
  discipline: "cs2";
  topic: Cs2Topic;
  params: Cs2TopicParams;
  roundNumber: number;
  resolve: "snapshot_diff";
}

export type SettlementCondition = SoccerSettlementCondition | Cs2SettlementCondition;

export interface Cs2TeamStats extends Cs2TeamIdentity {
  /** In-map round score, not series map wins. */
  score: number;
  deaths: number;
  weaponKills: ReadonlyArray<{ weaponName: string; count: number }>;
  players: ReadonlyArray<{ id: string; kills: number }>;
}

export interface Cs2Clock {
  ticking: boolean;
  currentSeconds: number;
}

export interface Cs2GameSnapshot {
  teams: readonly [Cs2TeamStats, Cs2TeamStats];
  clock: Cs2Clock;
}

export type Cs2SettlementInvalidReason =
  | "invalid_condition"
  | "team_identity_mismatch"
  | "unknown_team_id";

export type Cs2SettlementResult =
  | { status: "settled"; answer: Answer }
  | { status: "invalid"; reason: Cs2SettlementInvalidReason };

export type Cs2SettleFn = (
  condition: Cs2SettlementCondition,
  before: Cs2GameSnapshot,
  after: Cs2GameSnapshot,
) => Cs2SettlementResult;

export interface SettleableEvent {
  eventType: TargetEventType;
  team: TeamSide;
  matchMinute: number;
  confirmed: boolean;
}

export type SettleFn = (
  condition: SoccerSettlementCondition,
  events: SettleableEvent[],
) => Answer;
