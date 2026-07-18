import { describe, expect, it } from "vitest";

import {
  REPLAY_CYCLE_EXIT_CODE,
  shouldCycleReplay,
  shouldResetAfterGatewayExit,
} from "../replay-cycle-policy.js";

describe("replay cycle policy", () => {
  it("cycles only an explicitly enabled replay", () => {
    expect(shouldCycleReplay("replay", true)).toBe(true);
    expect(shouldCycleReplay("replay", false)).toBe(false);
    expect(shouldCycleReplay("live", true)).toBe(false);
  });

  it("resets only after successful cycle completion, never after crash or shutdown", () => {
    expect(shouldResetAfterGatewayExit(REPLAY_CYCLE_EXIT_CODE, false)).toBe(true);
    expect(shouldResetAfterGatewayExit(1, false)).toBe(false);
    expect(shouldResetAfterGatewayExit(null, false)).toBe(false);
    expect(shouldResetAfterGatewayExit(REPLAY_CYCLE_EXIT_CODE, true)).toBe(false);
  });
});
