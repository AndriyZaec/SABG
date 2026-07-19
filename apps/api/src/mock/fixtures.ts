// Mock fixtures — canned data conforming to @arena/contracts entity types.
// Stable UUIDs so REST responses and WS pushes reference the same match/arena/user
// across requests, letting the frontend develop against a consistent world.

import { MATCH_WINDOWS } from "@arena/contracts";
import type {
  Arena,
  ArenaPlayer,
  LeaderboardEntry,
  Match,
  MatchState,
  PredictionRound,
  User,
} from "@arena/contracts";

export const MOCK_USER_ID = "00000000-0000-0000-0000-000000000001";
export const MOCK_MATCH_ID = "00000000-0000-0000-0000-000000000010";
export const MOCK_ARENA_ID = "00000000-0000-0000-0000-000000000020";
export const MOCK_ENTRY_PASS_ID = "00000000-0000-0000-0000-000000000030";
export const MOCK_ARENA_PLAYER_ID = "00000000-0000-0000-0000-000000000040";

export const mockUser: User = {
  id: MOCK_USER_ID,
  walletAddress: "8F1x9y7bV3z6nQpR4sT2uW5xY6zA1bC3dE5fG7hJ9kL",
  username: "fan_alice",
};

export const mockMatch: Match = {
  id: MOCK_MATCH_ID,
  homeTeam: "Dynamo",
  awayTeam: "Shakhtar",
  startTime: new Date().toISOString(),
  status: "live",
  currentMinute: 12,
  period: "first_half",
  score: { home: 0, away: 0 },
};

/** Extra fixture matches so /matches has scheduled/live/finished variety for FE list UI. */
export const mockMatches: Match[] = [
  mockMatch,
  {
    id: "00000000-0000-0000-0000-000000000011",
    homeTeam: "Zorya",
    awayTeam: "Vorskla",
    startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    status: "scheduled",
    currentMinute: 0,
    period: "pre",
    score: { home: 0, away: 0 },
  },
  {
    id: "00000000-0000-0000-0000-000000000012",
    homeTeam: "Kolos",
    awayTeam: "Metalist",
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: "finished",
    currentMinute: 90,
    period: "full_time",
    score: { home: 2, away: 1 },
  },
];

export const mockArena: Arena = {
  id: MOCK_ARENA_ID,
  matchId: MOCK_MATCH_ID,
  status: "live",
  activePlayersCount: 128,
  entryFeeLamports: 100_000_000,
  prizePoolLamports: 12_800_000_000,
  escrowAccount: "ArEnAEscrowPDA11111111111111111111111111",
};

export const mockArenaPlayer: ArenaPlayer = {
  id: MOCK_ARENA_PLAYER_ID,
  arenaId: MOCK_ARENA_ID,
  userId: MOCK_USER_ID,
  status: "active",
  score: 0,
  joinedAt: new Date().toISOString(),
};

export const mockMatchState: MatchState = {
  matchId: MOCK_MATCH_ID,
  period: "first_half",
  currentMinute: 12,
  score: { home: 0, away: 0 },
  shots: { home: 3, away: 1 },
  corners: { home: 2, away: 0 },
  cards: { home: 0, away: 1 },
  activeWindowStartMinute: 10,
};

export const mockLeaderboard: LeaderboardEntry[] = [
  {
    userId: MOCK_USER_ID,
    username: mockUser.username,
    status: "active",
    score: 3,
    avgAnswerMs: 4200,
    missedCount: 0,
    joinedAt: mockArenaPlayer.joinedAt,
    rank: 1,
  },
  {
    userId: "00000000-0000-0000-0000-000000000002",
    username: "fan_bogdan",
    status: "active",
    score: 3,
    avgAnswerMs: 5100,
    missedCount: 1,
    joinedAt: mockArenaPlayer.joinedAt,
    rank: 2,
  },
  {
    userId: "00000000-0000-0000-0000-000000000003",
    username: "fan_carla",
    status: "active",
    score: 2,
    avgAnswerMs: 3800,
    missedCount: 0,
    joinedAt: mockArenaPlayer.joinedAt,
    rank: 3,
  },
  {
    userId: "00000000-0000-0000-0000-000000000004",
    username: "fan_dmytro",
    status: "eliminated",
    score: 1,
    avgAnswerMs: 6400,
    missedCount: 2,
    joinedAt: mockArenaPlayer.joinedAt,
  },
  {
    userId: "00000000-0000-0000-0000-000000000005",
    username: "fan_elena",
    status: "eliminated",
    score: 0,
    avgAnswerMs: 7000,
    missedCount: 3,
    joinedAt: mockArenaPlayer.joinedAt,
  },
];

/** Build a PredictionRound for a given @arena/contracts MATCH_WINDOWS entry. */
export function buildMockRound(
  windowIndex: number,
): PredictionRound {
  const window = MATCH_WINDOWS[windowIndex % MATCH_WINDOWS.length]!;
  return {
    id: `00000000-0000-0000-0000-0000000001${String(windowIndex).padStart(2, "0")}`,
    arenaId: MOCK_ARENA_ID,
    matchId: MOCK_MATCH_ID,
    windowStartMinute: window.start,
    windowEndMinute: window.end,
    question: `Will there be a shot on target (${window.start}-${window.end}')?`,
    targetEventType: "shot_on_target",
    targetTeam: "any",
    settlementCondition: {
      targetEventType: "shot_on_target",
      targetTeam: "any",
      windowStartMinute: window.start,
      windowEndMinute: window.end,
      resolve: "event_in_window",
    },
    status: "pending",
  };
}

export const mockCurrentRound: PredictionRound = buildMockRound(2);
