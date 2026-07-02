// @arena/contracts — shared source of truth (build plan S1 / P0.2).
// Import from "@arena/contracts" everywhere; never redefine these shapes locally.

export * from "./enums.js";
export * from "./settlement.js";
export * from "./entities.js";
export * from "./dto.js";
export * from "./ws.js";

/** Fixed 5-minute regular-time windows (spec §3). Halftime window 45–50 skipped by default (§3.2). */
export const MATCH_WINDOWS: ReadonlyArray<{ start: number; end: number }> =
  Array.from({ length: 18 }, (_, i) => ({ start: i * 5, end: i * 5 + 5 }));

/** Minimum lead time before window start that a round must open (spec §5). */
export const MIN_LEAD_TIME_SECONDS = 60;

/** Default halftime window that is skipped for MVP (spec §3.2). */
export const HALFTIME_WINDOW_START = 45;
