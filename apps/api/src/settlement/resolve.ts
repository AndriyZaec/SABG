// B4 — Settlement Engine core: the pure, idempotent S5 function (build plan §S5, spec §6).
// No I/O, no clock, no early/window-end distinction — the engine (engine.ts) decides *when* to
// call this; this only decides *what* the answer is given whatever events it's handed.

import type { SettleFn } from "@arena/contracts";

/**
 * `"yes"` if at least one confirmed event matches the condition's target type/team and falls
 * within `[windowStartMinute, windowEndMinute]` inclusive (spec §6); `"no"` otherwise. Called
 * with a growing event list as they arrive (early settlement) and, at worst, once more at
 * window-end — same function either way, so its result never depends on *when* it's called.
 */
export const resolveSettlement: SettleFn = (condition, events) =>
  events.some(
    (e) =>
      e.confirmed &&
      e.eventType === condition.targetEventType &&
      (condition.targetTeam === "any" || e.team === condition.targetTeam) &&
      e.matchMinute >= condition.windowStartMinute &&
      e.matchMinute <= condition.windowEndMinute,
  )
    ? "yes"
    : "no";
