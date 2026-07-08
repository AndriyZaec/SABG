import { describe, expect, it } from "vitest";
import {
  TARGET_WINDOW_STARTS,
  initialPlannerState,
  planRoundActions,
  requiredPeriod,
  type ClockTick,
  type PlannerState,
  type RoundAction,
} from "../planner.js";

/** Feeds a sequence of ticks through the planner, threading state, and returns all actions in order. */
function runTicks(ticks: ClockTick[], start: PlannerState = initialPlannerState()): { state: PlannerState; actions: RoundAction[] } {
  let state = start;
  const actions: RoundAction[] = [];
  for (const tick of ticks) {
    const result = planRoundActions(state, tick);
    state = result.state;
    actions.push(...result.actions);
  }
  return { state, actions };
}

describe("TARGET_WINDOW_STARTS", () => {
  it("has 17 windows, skipping the halftime window (45)", () => {
    expect(TARGET_WINDOW_STARTS).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 55, 60, 65, 70, 75, 80, 85]);
  });
});

describe("requiredPeriod", () => {
  it("maps windows before 45 to first_half and 45+ to second_half", () => {
    expect(requiredPeriod(0)).toBe("first_half");
    expect(requiredPeriod(40)).toBe("first_half");
    expect(requiredPeriod(50)).toBe("second_half");
    expect(requiredPeriod(85)).toBe("second_half");
  });
});

describe("planRoundActions", () => {
  it("opens the first round immediately in the pre-kickoff period", () => {
    const { actions, state } = planRoundActions(initialPlannerState(), { period: "pre", minute: 0 });
    expect(actions).toEqual([{ kind: "open", windowStart: 0 }]);
    expect(state).toEqual({ nextIndex: 1, openWindow: 0 });
  });

  it("locks window 0 at kickoff and immediately opens window 5", () => {
    const afterPre = planRoundActions(initialPlannerState(), { period: "pre", minute: 0 }).state;
    const { actions, state } = planRoundActions(afterPre, { period: "first_half", minute: 0 });
    expect(actions).toEqual([
      { kind: "lock", windowStart: 0 },
      { kind: "open", windowStart: 5 },
    ]);
    expect(state).toEqual({ nextIndex: 2, openWindow: 5 });
  });

  it("chains through interior first-half windows one lock+open pair per boundary crossed", () => {
    const { actions } = runTicks([
      { period: "pre", minute: 0 },
      { period: "first_half", minute: 0 },
      { period: "first_half", minute: 5 },
      { period: "first_half", minute: 10 },
      { period: "first_half", minute: 15 },
    ]);
    expect(actions).toEqual([
      { kind: "open", windowStart: 0 },
      { kind: "lock", windowStart: 0 },
      { kind: "open", windowStart: 5 },
      { kind: "lock", windowStart: 5 },
      { kind: "open", windowStart: 10 },
      { kind: "lock", windowStart: 10 },
      { kind: "open", windowStart: 15 },
      // the final tick's minute (15) also reaches window 15's own lock point, so it locks and
      // the next window opens in the same tick — locking always fires as soon as minute >= W.
      { kind: "lock", windowStart: 15 },
      { kind: "open", windowStart: 20 },
    ]);
  });

  it("does not open the halftime window (45) and holds window 50 until second_half", () => {
    const { state, actions } = runTicks([
      { period: "pre", minute: 0 },
      { period: "first_half", minute: 0 },
      { period: "first_half", minute: 40 }, // locks 35, opens 40
      { period: "first_half", minute: 40 }, // no-op (already open, minute hasn't reached 40 again... equal is fine)
      { period: "halftime", minute: 40 }, // locks 40 (period moved past first_half); 50 not eligible yet (halftime rank < second_half rank)
      { period: "halftime", minute: 40 }, // still nothing to open
    ]);
    // No "open windowStart: 45" ever appears.
    expect(actions.some((a) => a.windowStart === 45)).toBe(false);
    // Window 40 is locked, and nothing is open during halftime.
    expect(actions.at(-1)).toEqual({ kind: "lock", windowStart: 40 });
    expect(state.openWindow).toBeUndefined();
    expect(state.nextIndex).toBe(TARGET_WINDOW_STARTS.indexOf(50));
  });

  it("opens window 50 as soon as the second half kicks off", () => {
    const beforeSecondHalf = runTicks([
      { period: "pre", minute: 0 },
      { period: "first_half", minute: 0 },
      { period: "first_half", minute: 40 },
      { period: "halftime", minute: 40 },
    ]).state;

    const { actions } = planRoundActions(beforeSecondHalf, { period: "second_half", minute: 45 });
    expect(actions).toEqual([{ kind: "open", windowStart: 50 }]);
  });

  it("catches up across a minute gap within the same period (locks + opens intermediate windows in one tick)", () => {
    const midFirstHalf = runTicks([
      { period: "pre", minute: 0 },
      { period: "first_half", minute: 0 }, // opens 5 (after locking 0)
    ]).state;
    expect(midFirstHalf.openWindow).toBe(5);

    // A feed gap jumps straight from minute 0 to minute 22 — should lock/open 5, 10, 15, 20 in
    // order and leave window 20 open (not yet reached its own lock at minute 20... wait minute
    // is 22 >= 20, so 20 locks too and 25 opens).
    const { actions, state } = planRoundActions(midFirstHalf, { period: "first_half", minute: 22 });
    expect(actions).toEqual([
      { kind: "lock", windowStart: 5 },
      { kind: "open", windowStart: 10 },
      { kind: "lock", windowStart: 10 },
      { kind: "open", windowStart: 15 },
      { kind: "lock", windowStart: 15 },
      { kind: "open", windowStart: 20 },
      { kind: "lock", windowStart: 20 },
      { kind: "open", windowStart: 25 },
    ]);
    expect(state.openWindow).toBe(25);
  });

  it("catches up across a period jump, locking all remaining windows of the finished half in one tick", () => {
    const midSecondHalf = runTicks([
      { period: "pre", minute: 0 },
      { period: "first_half", minute: 0 },
      { period: "first_half", minute: 40 },
      { period: "halftime", minute: 40 },
      { period: "second_half", minute: 45 }, // opens 50
      { period: "second_half", minute: 50 }, // locks 50, opens 55 (minute 50 doesn't reach 55's own lock yet)
    ]).state;
    expect(midSecondHalf.openWindow).toBe(55);

    // Jump straight to full_time without seeing minutes 60..90 tick individually.
    const { actions, state } = planRoundActions(midSecondHalf, { period: "full_time", minute: 97 });
    const lockedWindows = actions.filter((a) => a.kind === "lock").map((a) => a.windowStart);
    expect(lockedWindows).toEqual([55, 60, 65, 70, 75, 80, 85]);
    expect(state.openWindow).toBeUndefined();
    expect(state.nextIndex).toBe(TARGET_WINDOW_STARTS.length);
  });

  it("is a no-op once every window has locked", () => {
    let state = initialPlannerState();
    for (const tick of [
      { period: "pre", minute: 0 } as const,
      { period: "first_half", minute: 0 } as const,
      { period: "first_half", minute: 40 } as const,
      { period: "halftime", minute: 40 } as const,
      { period: "second_half", minute: 45 } as const,
      { period: "full_time", minute: 97 } as const,
    ]) {
      state = planRoundActions(state, tick).state;
    }
    expect(state.nextIndex).toBe(TARGET_WINDOW_STARTS.length);
    expect(state.openWindow).toBeUndefined();

    const { actions } = planRoundActions(state, { period: "full_time", minute: 98 });
    expect(actions).toEqual([]);
  });
});
