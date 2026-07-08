// B3 — Round Engine core: a pure, unit-testable planner over match clock ticks (build plan §B3,
// spec §5). Decides which window opens/locks next; no I/O, no wall-clock, no question text —
// CLAUDE.md "pure functions at the core, side effects at the edges" (engine.ts is the edge).

import { HALFTIME_WINDOW_START, MATCH_WINDOWS, type MatchPeriod } from "@arena/contracts";

/** Regular-time window starts with the halftime window (spec §3.2) skipped: [0,5,...,40,50,...,85]. */
export const TARGET_WINDOW_STARTS: readonly number[] = MATCH_WINDOWS.filter(
  (w) => w.start !== HALFTIME_WINDOW_START,
).map((w) => w.start);

/** Ordering used to detect "we've moved past this window's period" (spec §3.2, §5). */
const PERIOD_RANK: Record<MatchPeriod, number> = {
  pre: 0,
  first_half: 1,
  halftime: 2,
  second_half: 3,
  full_time: 4,
};

/** Which period a window start belongs to (spec §3: first half 0-45, second half 50-90). */
export function requiredPeriod(windowStart: number): Extract<MatchPeriod, "first_half" | "second_half"> {
  return windowStart < HALFTIME_WINDOW_START ? "first_half" : "second_half";
}

export interface PlannerState {
  /** Index into TARGET_WINDOW_STARTS of the next window to open. */
  nextIndex: number;
  /** windowStart of the currently-open round, or undefined if none is open. */
  openWindow: number | undefined;
}

export function initialPlannerState(): PlannerState {
  return { nextIndex: 0, openWindow: undefined };
}

export interface ClockTick {
  period: MatchPeriod;
  /** Match minute incl. stoppage, meaningful only paired with `period` (see match-signal.ts). */
  minute: number;
}

export type RoundAction =
  | { kind: "open"; windowStart: number }
  | { kind: "lock"; windowStart: number };

/**
 * Advances the planner by one clock tick, returning the actions to take and the next state.
 * Loops internally so a single tick can catch up across several windows at once (a feed gap, a
 * mid-match join, or a period jump straight past several remaining windows of the prior half).
 */
export function planRoundActions(
  state: PlannerState,
  tick: ClockTick,
): { state: PlannerState; actions: RoundAction[] } {
  let { nextIndex, openWindow } = state;
  const actions: RoundAction[] = [];

  for (;;) {
    let progressed = false;

    if (openWindow !== undefined) {
      const req = requiredPeriod(openWindow);
      // Lock is always exactly at window start T (spec §5) — reached either by the minute
      // catching up within the window's own period, or by the period having moved past it
      // entirely (catch-up: we never saw the minute cross T, but we're clearly past it now).
      const reachedLock = PERIOD_RANK[tick.period] > PERIOD_RANK[req] || (tick.period === req && tick.minute >= openWindow);
      if (reachedLock) {
        actions.push({ kind: "lock", windowStart: openWindow });
        openWindow = undefined;
        progressed = true;
      }
    }

    if (openWindow === undefined && nextIndex < TARGET_WINDOW_STARTS.length) {
      const candidate = TARGET_WINDOW_STARTS[nextIndex]!;
      const req = requiredPeriod(candidate);
      // The very first round opens immediately (even pre-kickoff, spec §5's "first round opens
      // >= leadTime before kickoff"); every later one opens as soon as its half has started —
      // sequencing (a window only becomes "next" once its predecessor locked) already keeps
      // opens in minute order within a half, and this period gate is what creates the halftime
      // pause: a second-half window can't open until period is actually "second_half".
      const eligible = nextIndex === 0 || PERIOD_RANK[tick.period] >= PERIOD_RANK[req];
      if (eligible) {
        actions.push({ kind: "open", windowStart: candidate });
        openWindow = candidate;
        nextIndex += 1;
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  return { state: { nextIndex, openWindow }, actions };
}
