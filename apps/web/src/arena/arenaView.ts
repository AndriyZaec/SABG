import type { MatchPeriod } from "@arena/contracts";

/** View model the Live Arena renders from. Fed by seeded demo data now, by the WS hook in 5d. */
export interface ArenaView {
  home: string;
  away: string;
  score: { home: number; away: number };
  minute: number;
  period: MatchPeriod;
  survivors: number;
  totalPlayers: number;
}

/** Illustrative state so /arena/demo looks alive without a running backend. */
export const DEMO_VIEW: ArenaView = {
  home: "Arsenal",
  away: "Chelsea",
  score: { home: 1, away: 0 },
  minute: 27,
  period: "first_half",
  survivors: 8,
  totalPlayers: 24,
};

export const PERIOD_LABEL: Record<MatchPeriod, string> = {
  pre: "Pre-match",
  first_half: "1st half",
  halftime: "Half-time",
  second_half: "2nd half",
  full_time: "Full time",
};
