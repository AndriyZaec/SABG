// S5 — machine-readable settlement condition DSL (build plan §S5).
// Produced by Question Generator (B5), consumed by Settlement Engine (B4).
// The Settlement Engine is a pure function: (condition, events[]) => Answer.

import type { TargetEventType, TeamSide, Answer } from "./enums.js";

/**
 * Deterministic settlement condition attached to every PredictionRound.
 * `resolve` currently supports a single strategy; keep it extensible.
 */
export interface SettlementCondition {
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

/** Signature of the isolated, unit-testable settlement function (B4 / build plan §S5). */
export type SettleFn = (
  condition: SettlementCondition,
  events: SettleableEvent[],
) => Answer;
