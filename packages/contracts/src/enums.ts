// Enums & string-literal unions shared across backend, frontend and on-chain client.
// Source of truth: spec v2 §4.1, §5, §7, §13.

/** Whitelisted, deterministically-detectable settlement target events (spec §4.1). */
export const TARGET_EVENT_TYPES = [
  "shot",
  "shot_on_target",
  "corner",
  "card",
  "goal",
  "free_kick",
  "penalty",
  "substitution",
] as const;
export type TargetEventType = (typeof TARGET_EVENT_TYPES)[number];

/** Which side a question / event targets. */
export type TeamSide = "home" | "away" | "any";

/** Match period lifecycle (spec §13 Match.period). */
export type MatchPeriod =
  | "pre"
  | "first_half"
  | "halftime"
  | "second_half"
  | "full_time";

export type MatchStatus = "scheduled" | "live" | "finished";

/** Arena lifecycle (spec §13 Arena.status). */
export type ArenaStatus = "lobby" | "live" | "finished";

/** Per-player state within an arena (spec §13 ArenaPlayer.status). */
export type ArenaPlayerStatus = "active" | "eliminated" | "winner";

/** Round lifecycle (spec §5, §13 PredictionRound.status). */
export type RoundStatus = "pending" | "open" | "locked" | "settled";

/** How a round was resolved (spec §6, §13 PredictionRound.settledBy). */
export type SettledBy = "early" | "window_end";

export type Answer = "yes" | "no";

/** Result of a player's prediction (spec §6, §13 Prediction.result). */
export type PredictionResult = "correct" | "incorrect" | "missed";

export type EntryPassStatus = "paid" | "refunded";

export type PayoutStatus = "pending" | "sent" | "failed";
