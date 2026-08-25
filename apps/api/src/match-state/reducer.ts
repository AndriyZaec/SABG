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

export function windowStartForMinute(minute: number): number {
  const clamped = Math.min(Math.max(minute, 0), 85);
  return Math.floor(clamped / 5) * 5;
}

const COUNTER_FOR_EVENT_TYPE: Partial<Record<TargetEventType, "score" | "shots" | "corners" | "cards">> = {
  goal: "score",
  shot: "shots",
  corner: "corners",
  card: "cards",
};

function bump(score: Score, team: "home" | "away"): Score {
  return { ...score, [team]: score[team] + 1 };
}

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
      if (signal.event.team === "any") return state;
      const counter = COUNTER_FOR_EVENT_TYPE[signal.event.eventType];
      if (counter === undefined) return state;
      return { ...state, [counter]: bump(state[counter], signal.event.team) };
    }

    default:
      return state;
  }
}
