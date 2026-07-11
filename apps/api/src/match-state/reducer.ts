// Match State Engine core: a pure, unit-testable reducer over the `MatchSignal` stream. No I/O,
// no raw feed knowledge — CLAUDE.md "pure functions at the core, side effects at the edges".

import type { MatchSignal, MatchState, Score, TargetEventType, Uuid } from "@arena/contracts";

export function initialMatchState(matchId: Uuid): MatchState {
  return {
    matchId,
    period: "pre",
    currentMinute: 0,
    score: { home: 0, away: 0 },
    shots: { home: 0, away: 0 },
    corners: { home: 0, away: 0 },
    cards: { home: 0, away: 0 },
  };
}

/**
 * Floors a match minute to its 5-minute window boundary, capped to the last regular-time
 * window (spec §3: 18 fixed windows, 00:00–90:00). Informational context only — the round
 * engine owns authoritative round windowing, lead time and halftime skip.
 */
export function windowStartForMinute(minute: number): number {
  const clamped = Math.min(Math.max(minute, 0), 85);
  return Math.floor(clamped / 5) * 5;
}

/** MatchState counter fields that a whitelisted target event can increment. */
const COUNTER_FOR_EVENT_TYPE: Partial<Record<TargetEventType, "score" | "shots" | "corners" | "cards">> = {
  goal: "score",
  shot: "shots",
  corner: "corners",
  card: "cards",
};

function bump(score: Score, team: "home" | "away"): Score {
  return { ...score, [team]: score[team] + 1 };
}

/**
 * Reduces one `MatchSignal` onto the current `MatchState`. Returns the **same reference** when
 * the signal is a no-op (e.g. a duplicate clock tick), so callers can cheaply detect real
 * changes without a deep-equality check.
 */
export function reduceMatchState(state: MatchState, signal: MatchSignal): MatchState {
  switch (signal.kind) {
    case "clock": {
      const activeWindowStartMinute = windowStartForMinute(signal.matchMinute);
      if (
        state.period === signal.period &&
        state.currentMinute === signal.matchMinute &&
        state.activeWindowStartMinute === activeWindowStartMinute
      ) {
        return state;
      }
      return { ...state, period: signal.period, currentMinute: signal.matchMinute, activeWindowStartMinute };
    }

    case "possession": {
      if (state.possession === signal.team) return state;
      return { ...state, possession: signal.team };
    }

    case "event": {
      // "any"-team events (no side attribution) and non-counted target types (shot_on_target,
      // penalty, substitution — no MatchState field per spec §13) leave state untouched.
      if (signal.event.team === "any") return state;
      const counter = COUNTER_FOR_EVENT_TYPE[signal.event.eventType];
      if (counter === undefined) return state;
      return { ...state, [counter]: bump(state[counter], signal.event.team) };
    }
  }
}
