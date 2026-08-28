export const DISCIPLINES = ["soccer", "cs2"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

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

export const TEAM_SIDES = ["home", "away", "any"] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

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

/** `cancelled` is terminal. */
export const ARENA_STATUSES = ["lobby", "live", "finished", "cancelled"] as const;
export type ArenaStatus = (typeof ARENA_STATUSES)[number];

export const ARENA_CANCELLED_REASONS = ["no_show", "series_decided"] as const;
export type ArenaCancelledReason = (typeof ARENA_CANCELLED_REASONS)[number];

export const ARENA_PLAYER_STATUSES = ["active", "eliminated", "winner"] as const;
export type ArenaPlayerStatus = (typeof ARENA_PLAYER_STATUSES)[number];

export const ROUND_STATUSES = ["pending", "open", "locked", "settled", "voided"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const SETTLED_BY_VALUES = ["early", "window_end", "round_end"] as const;
export type SettledBy = (typeof SETTLED_BY_VALUES)[number];

export const ANSWERS = ["yes", "no"] as const;
export type Answer = (typeof ANSWERS)[number];

export const PREDICTION_RESULTS = ["correct", "incorrect", "missed"] as const;
export type PredictionResult = (typeof PREDICTION_RESULTS)[number];

export const SERIES_STATUSES = ["active", "decided", "invalid"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

export const CS2_SERIES_LIFECYCLES = [
  "upcoming",
  "live",
  "completed",
  "unknown",
] as const;
export type Cs2SeriesLifecycle = (typeof CS2_SERIES_LIFECYCLES)[number];

export const CS2_SERIES_AVAILABILITIES = ["available", "soon"] as const;
export type Cs2SeriesAvailability = (typeof CS2_SERIES_AVAILABILITIES)[number];

export const ENTRY_PASS_STATUSES = ["paid", "refunded"] as const;
export type EntryPassStatus = (typeof ENTRY_PASS_STATUSES)[number];

export const PAYOUT_STATUSES = ["pending", "sent", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
