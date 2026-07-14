import type { Answer, MatchPeriod, RoundStatus } from "@arena/contracts";

/** The current prediction round as the arena screen needs it. */
export interface RoundView {
  question: string;
  windowStartMinute: number;
  windowEndMinute: number;
  status: RoundStatus;
  /** Epoch ms when answers lock. */
  lockAt: number;
  myAnswer?: Answer;
  correctAnswer?: Answer;
}

/** View model the Live Arena renders from. Fed by seeded demo data now, by the WS hook in 5d. */
export interface ArenaView {
  home: string;
  away: string;
  score: { home: number; away: number };
  minute: number;
  period: MatchPeriod;
  survivors: number;
  totalPlayers: number;
  round?: RoundView;
}

/** Base match state. */
export const DEMO_VIEW: ArenaView = {
  home: "Arsenal",
  away: "Chelsea",
  score: { home: 1, away: 0 },
  minute: 27,
  period: "first_half",
  survivors: 8,
  totalPlayers: 24,
};

/** Illustrative state so /arena/demo looks alive without a backend — fresh countdown each load. */
export function makeDemoView(): ArenaView {
  return {
    ...DEMO_VIEW,
    round: {
      question: "Will Arsenal have a shot between 25:00 and 30:00?",
      windowStartMinute: 25,
      windowEndMinute: 30,
      status: "open",
      lockAt: Date.now() + 45_000,
    },
  };
}

export const PERIOD_LABEL: Record<MatchPeriod, string> = {
  pre: "Pre-match",
  first_half: "1st half",
  halftime: "Half-time",
  second_half: "2nd half",
  full_time: "Full time",
};
