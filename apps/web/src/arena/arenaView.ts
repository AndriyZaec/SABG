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

export interface FeedItem {
  id: string;
  kind: "eliminated" | "survived" | "info";
  text: string;
  minute?: number;
}

export interface LeaderRow {
  rank: number;
  name: string;
  score: number;
  status: "active" | "eliminated" | "winner";
  you?: boolean;
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
  feed: FeedItem[];
  leaderboard: LeaderRow[];
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
  feed: [
    { id: "f4", kind: "eliminated", text: "blueslad_99 eliminated", minute: 25 },
    { id: "f3", kind: "info", text: "Round 5 open · shot 25–30", minute: 25 },
    { id: "f2", kind: "survived", text: "You survived round 4", minute: 20 },
    { id: "f1", kind: "eliminated", text: "crypto_gooner eliminated", minute: 20 },
  ],
  leaderboard: [
    { rank: 1, name: "You", score: 5, status: "active", you: true },
    { rank: 1, name: "kante_stan", score: 5, status: "active" },
    { rank: 3, name: "odegaard_8", score: 4, status: "active" },
    { rank: 4, name: "blueslad_99", score: 3, status: "eliminated" },
    { rank: 4, name: "crypto_gooner", score: 3, status: "eliminated" },
  ],
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
