// S5 — machine-readable settlement condition DSL (build plan §S5).
// Produced by Question Generator (B5), consumed by Settlement Engine (B4).
// The Settlement Engine is a pure function: (condition, events[]) => Answer.
//
// Discipline-tagged union (cs2-migration-spec/spec_v2.md §3): round engine internals stay
// separate per discipline, but every PredictionRound needs a settlement condition, so this DSL
// grows one branch per discipline rather than becoming two unrelated types.

import type { TargetEventType, TeamSide, Answer } from "./enums.js";

/**
 * Soccer's settlement condition (spec §5-§6, unchanged). `resolve` currently supports a single
 * strategy; keep it extensible.
 */
export interface SoccerSettlementCondition {
  discipline: "soccer";
  targetEventType: TargetEventType;
  targetTeam: TeamSide;
  /** Window start minute, inclusive (match clock, spec §3). */
  windowStartMinute: number;
  /** Window end minute, inclusive of stoppage folded into boundary windows. */
  windowEndMinute: number;
  /** YES if >= 1 confirmed matching event occurs in [start, end]. */
  resolve: "event_in_window";
}

/**
 * CS2 catalog topics (cs2-migration-spec/spec_v2.md §7 п.7, §7 п.4/п.5 for the two fixed
 * rounds). `pistol_round` is fixed to Round 13; `ot_score` is fixed to Round 24 — both still use
 * `snapshot_diff` machinery (pistol reads round-winner diff, ot_score reads the after-snapshot
 * score directly).
 */
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

/** Whitelisted weapons for the `weapon_kill` topic (spec §7 п.7). */
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

/**
 * Per-topic parameters (spec §7 п.7). Only the field relevant to `topic` is set — enforced by
 * `Cs2SettlementCondition`'s discriminated union below, not by this shape alone.
 */
export interface Cs2TopicParams {
  /** `targetTeam` for team_ace/multikill/survivors_team/round_winner/pistol_round. */
  targetTeam?: TeamSide;
  /** `weapon_kill` only. */
  weapon?: Cs2Weapon;
  /** `multikill` (2-5) or `survivors_team`/`survivors_round` (0-4 / 0-5) threshold. */
  y?: number;
}

/**
 * CS2's settlement condition (spec §7 п.7, §10): diff of the snapshot at round-lock vs the
 * snapshot right after round-end detection, no per-event kill feed needed. Fixed rounds
 * (pistol_round, ot_score) reuse the same `snapshot_diff` resolve strategy.
 */
export interface Cs2SettlementCondition {
  discipline: "cs2";
  topic: Cs2Topic;
  params: Cs2TopicParams;
  /** The Round (not PredictionRound) this settles, spec §2. */
  roundNumber: number;
  resolve: "snapshot_diff";
}

export type SettlementCondition = SoccerSettlementCondition | Cs2SettlementCondition;

/**
 * Per-team cumulative stats read off one GRID `seriesState.games[0].teams[]` snapshot — the
 * minimal diff-able shape every CS2 catalog topic needs (spec §7 п.7, §8). Kept narrow
 * deliberately: GRID's full payload carries far more (see `apps/api/src/grid/series-state.ts`),
 * this is only what settlement math reads.
 */
export interface Cs2TeamStats {
  name: string;
  /** In-game round score (maps won is series-level, not here). */
  score: number;
  deaths: number;
  weaponKills: ReadonlyArray<{ weaponName: string; count: number }>;
  players: ReadonlyArray<{ id: string; kills: number }>;
}

/** One parsed GRID snapshot's diff-relevant slice — always exactly two teams, index-stable. */
export interface Cs2GameSnapshot {
  teams: readonly [Cs2TeamStats, Cs2TeamStats];
}

/** Signature of the isolated, unit-testable CS2 settlement function (spec §7 п.7, "diff of two snapshots"). */
export type Cs2SettleFn = (
  condition: Cs2SettlementCondition,
  before: Cs2GameSnapshot,
  after: Cs2GameSnapshot,
) => Answer;

/**
 * Minimal event shape the pure settlement function needs (subset of LiveEvent).
 *
 * `team` includes `"any"` — normalize.ts's `participantToSide` falls back to `"any"` for a raw
 * message it can't attribute to a specific side. That's still real settlement evidence for an
 * `"any"`-team condition (the question doesn't care which team), just not for a specific-team one
 * (home/away) where an unattributable event genuinely can't confirm that side did it. `resolve.ts`
 * already encodes exactly that distinction (`condition.targetTeam === "any" || e.team ===
 * condition.targetTeam`) — this type only needs to stop rejecting the "any" case outright.
 */
export interface SettleableEvent {
  eventType: TargetEventType;
  team: TeamSide;
  /** Match minute incl. stoppage (e.g. 45 for 45+2 folded into 40–45 window). */
  matchMinute: number;
  confirmed: boolean;
}

/** Signature of the isolated, unit-testable settlement function (B4 / build plan §S5). Soccer only. */
export type SettleFn = (
  condition: SoccerSettlementCondition,
  events: SettleableEvent[],
) => Answer;
