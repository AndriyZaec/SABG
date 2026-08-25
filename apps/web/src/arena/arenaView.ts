import type {
  Answer,
  ArenaPlayerStatus,
  ArenaRoundsResponse,
  MatchPeriod,
  PendingPrediction,
  RoundStatus,
  Uuid,
} from "@arena/contracts";

export interface RoundView {
  roundId: string;
  question: string;
  windowStartMinute: number;
  windowEndMinute: number;
  status: RoundStatus;
  /** Undefined until the authoritative live state provides a lock time. */
  lockAt?: number;
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

export interface ArenaView {
  home: string;
  away: string;
  score: { home: number; away: number };
  minute: number;
  period: MatchPeriod;
  survivors: number;
  totalPlayers: number;
  round?: RoundView;
  /** Undefined until personal state is received or restored on reconnect. */
  myStatus?: ArenaPlayerStatus;
  /** Authoritative snapshot of this player's locked, unsettled predictions. */
  pendingPredictions?: PendingPrediction[];
  feed: FeedItem[];
  leaderboard: LeaderRow[];
}

export function truncate(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function feedFromRounds(rounds: ArenaRoundsResponse["rounds"], myUserId?: Uuid): FeedItem[] {
  const settled = rounds
    .filter((r) => r.round.status === "settled" && r.round.correctAnswer !== undefined)
    .sort((a, b) => (b.round.settledAt ?? "").localeCompare(a.round.settledAt ?? ""));

  const items: FeedItem[] = [];
  for (const { round, predictions } of settled) {
    items.push({
      id: `settle-${round.id}`,
      kind: "info",
      text: `Round settled · ${truncate(round.question)} · answer ${round.correctAnswer!.toUpperCase()}`,
      minute: round.windowEndMinute,
    });
    const mine = myUserId !== undefined ? predictions.find((p) => p.userId === myUserId) : undefined;
    if (mine?.result !== undefined) {
      items.push({
        id: `me-${round.id}`,
        kind: mine.result === "correct" ? "survived" : "eliminated",
        text: mine.result === "correct" ? "You survived" : "You were eliminated",
        minute: round.windowEndMinute,
      });
    }
  }
  return items.slice(0, 20);
}

export const DEMO_VIEW: ArenaView = {
  home: "England",
  away: "Argentina",
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

export function makeDemoView(): ArenaView {
  return {
    ...DEMO_VIEW,
    round: {
      roundId: "demo-round",
      question: "Will England have a shot between 25:00 and 30:00?",
      windowStartMinute: 25,
      windowEndMinute: 30,
      status: "open",
      lockAt: Date.now() + 45_000,
    },
    pendingPredictions: [
      {
        roundId: "demo-round-prior",
        question: "Will there be a corner between 20:00 and 25:00?",
        windowStartMinute: 20,
        windowEndMinute: 25,
        answer: "yes",
      },
    ],
  };
}

export const PERIOD_LABEL: Record<MatchPeriod, string> = {
  pre: "Pre-match",
  first_half: "1st half",
  halftime: "Half-time",
  second_half: "2nd half",
  full_time: "Full time",
};
