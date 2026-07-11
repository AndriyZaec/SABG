// Feed `Action` -> @arena/contracts TargetEventType whitelist (spec §4.1).
// Anything not listed here (possession, throw_in, goal_kick, free_kick, jersey, comment,
// status, ...) is not a valid settlement target and is dropped by the normalizer.

import type { TargetEventType } from "@arena/contracts";

export const ACTION_TO_TARGET_EVENT_TYPE: Readonly<Record<string, TargetEventType>> = {
  goal: "goal",
  shot: "shot",
  corner: "corner",
  yellow_card: "card",
  second_yellow_card: "card",
  red_card: "card",
  substitution: "substitution",
  penalty_attempt: "penalty",
  penalty_outcome: "penalty",
};

export function targetEventTypeForAction(action: string | undefined): TargetEventType | undefined {
  if (action === undefined) return undefined;
  return ACTION_TO_TARGET_EVENT_TYPE[action];
}
