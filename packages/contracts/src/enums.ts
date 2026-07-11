// Enums & string-literal unions shared across backend, frontend and on-chain client.
// Source of truth: spec v2 §4.1, §5, §7, §13.

/**
 * Whitelisted, deterministically-detectable settlement target events (spec §4.1).
 * `free_kick` is deliberately excluded: it occurs too often per match to make a
 * non-trivial round target (spec §4.2 — avoid trivially-resolved questions).
 */
export const TARGET_EVENT_TYPES = [
  "shot",
  "shot_on_target",
  "corner",
  "card",
  "goal",
  "penalty",
  "substitution",
] as const;
export type TargetEventType = (typeof TARGET_EVENT_TYPES)[number];

/** Which side a question / event targets. */
export const TEAM_SIDES = ["home", "away", "any"] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

/** Match period lifecycle (spec §13 Match.period). */
export const MATCH_PERIODS = [
  "pre",
  "first_half",
  "halftime",
  "second_half",
  "full_time",
] as const;
export type MatchPeriod = (typeof MATCH_PERIODS)[number];

export const MATCH_STATUSES = ["scheduled", "live", "finished"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Arena lifecycle (spec §13 Arena.status). */
export const ARENA_STATUSES = ["lobby", "live", "finished"] as const;
export type ArenaStatus = (typeof ARENA_STATUSES)[number];

/** Per-player state within an arena (spec §13 ArenaPlayer.status). */
export const ARENA_PLAYER_STATUSES = ["active", "eliminated", "winner"] as const;
export type ArenaPlayerStatus = (typeof ARENA_PLAYER_STATUSES)[number];

/** Round lifecycle (spec §5, §13 PredictionRound.status). */
export const ROUND_STATUSES = ["pending", "open", "locked", "settled"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

/** How a round was resolved (spec §6, §13 PredictionRound.settledBy). */
export const SETTLED_BY_VALUES = ["early", "window_end"] as const;
export type SettledBy = (typeof SETTLED_BY_VALUES)[number];

export const ANSWERS = ["yes", "no"] as const;
export type Answer = (typeof ANSWERS)[number];

/** Result of a player's prediction (spec §6, §13 Prediction.result). */
export const PREDICTION_RESULTS = ["correct", "incorrect", "missed"] as const;
export type PredictionResult = (typeof PREDICTION_RESULTS)[number];

export const ENTRY_PASS_STATUSES = ["paid", "refunded"] as const;
export type EntryPassStatus = (typeof ENTRY_PASS_STATUSES)[number];

export const PAYOUT_STATUSES = ["pending", "sent", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
