// Mock fixtures — canned data conforming to @arena/contracts entity types.
// Stable UUIDs so REST responses and WS pushes reference the same match/arena/user
// across requests, letting the frontend develop against a consistent world.

import { MATCH_WINDOWS } from "@arena/contracts";
import type {
  Arena,
  ArenaPlayer,
  Cs2Match,
  Cs2SeriesDetail,
  Cs2SeriesSummary,
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
export const MOCK_CS2_SERIES_ID = "10000000-0000-4000-8000-000000000001";
export const MOCK_CS2_TEAM_A_ID = "10000000-0000-4000-8000-000000000002";
export const MOCK_CS2_TEAM_B_ID = "10000000-0000-4000-8000-000000000003";
export const MOCK_CS2_MATCH_ID = "10000000-0000-4000-8000-000000000004";
export const MOCK_CS2_ARENA_ID = "10000000-0000-4000-8000-000000000005";
export const MOCK_CS2_UPCOMING_SERIES_ID = "10000000-0000-4000-8000-000000000006";
export const MOCK_CS2_UPCOMING_TEAM_ID = "10000000-0000-4000-8000-000000000007";
export const MOCK_CS2_LOBBY_MATCH_ID = "10000000-0000-4000-8000-000000000008";
export const MOCK_CS2_LOBBY_ARENA_ID = "10000000-0000-4000-8000-000000000009";
export const MOCK_CS2_MOUZ_SERIES_ID = "10000000-0000-4000-8000-00000000000a";
export const MOCK_CS2_MOUZ_TEAM_ID = "10000000-0000-4000-8000-00000000000b";

const mockCompetition = {
  name: "BLAST Premier Fall Final",
  shortName: "BLAST Fall Final",
  logoUrl: "/cs2-api/mock-assets/blast.svg",
} as const;

export const mockCs2SeriesSummary: Cs2SeriesSummary = {
  id: MOCK_CS2_SERIES_ID,
  availability: "available",
  participants: [
    {
      state: "known",
      displayOrder: 1,
      team: {
        id: MOCK_CS2_TEAM_A_ID,
        name: "Team Spirit",
        shortName: "Spirit",
        logoUrl: "/cs2-api/mock-assets/spirit.svg",
      },
      seriesScore: 1,
    },
    {
      state: "known",
      displayOrder: 2,
      team: {
        id: MOCK_CS2_TEAM_B_ID,
        name: "Team Vitality",
        shortName: "Vitality",
        logoUrl: "/cs2-api/mock-assets/vitality.svg",
      },
      seriesScore: 0,
    },
  ],
  competition: mockCompetition,
  format: 3,
  scheduledStartTime: "2026-08-26T18:00:00.000Z",
  lifecycle: "live",
};

export const mockCs2SeriesDetail: Cs2SeriesDetail = {
  ...mockCs2SeriesSummary,
  maps: [
    {
      state: "finished",
      seriesMatchIndex: 1,
      mapName: "Mirage",
      matchId: MOCK_CS2_MATCH_ID,
      teams: [
        { teamId: MOCK_CS2_TEAM_A_ID, score: 13 },
        { teamId: MOCK_CS2_TEAM_B_ID, score: 9 },
      ],
      arena: {
        id: MOCK_CS2_ARENA_ID,
        activePlayersCount: 128,
        entryFeeLamports: 100_000_000,
        prizePoolLamports: 12_800_000_000,
      },
    },
    {
      state: "lobby",
      seriesMatchIndex: 2,
      mapName: "Nuke",
      matchId: MOCK_CS2_LOBBY_MATCH_ID,
      teams: [
        { teamId: MOCK_CS2_TEAM_A_ID, score: 0 },
        { teamId: MOCK_CS2_TEAM_B_ID, score: 0 },
      ],
      arena: {
        id: MOCK_CS2_LOBBY_ARENA_ID,
        activePlayersCount: 84,
        entryFeeLamports: 100_000_000,
        prizePoolLamports: 8_400_000_000,
      },
    },
    { state: "pending", seriesMatchIndex: 3, mapName: "Anubis" },
  ],
};

export const mockCs2UpcomingSeriesSummary: Cs2SeriesSummary = {
  id: MOCK_CS2_UPCOMING_SERIES_ID,
  availability: "soon",
  participants: [
    {
      state: "known",
      displayOrder: 1,
      team: {
        id: MOCK_CS2_UPCOMING_TEAM_ID,
        name: "Natus Vincere",
        shortName: "NAVI",
        logoUrl: "/cs2-api/mock-assets/navi.svg",
      },
      seriesScore: 0,
    },
    { state: "tbd", displayOrder: 2, seriesScore: null },
  ],
  competition: mockCompetition,
  format: 3,
  scheduledStartTime: "2026-08-27T16:00:00.000Z",
  lifecycle: "upcoming",
};

export const mockCs2UpcomingSeriesDetail: Cs2SeriesDetail = {
  ...mockCs2UpcomingSeriesSummary,
  maps: [
    { state: "pending", seriesMatchIndex: 1 },
    { state: "pending", seriesMatchIndex: 2 },
    { state: "pending", seriesMatchIndex: 3 },
  ],
};

export const mockCs2MouzSeriesSummary: Cs2SeriesSummary = {
  id: MOCK_CS2_MOUZ_SERIES_ID,
  availability: "soon",
  participants: [
    mockCs2UpcomingSeriesSummary.participants[0],
    {
      state: "known",
      displayOrder: 2,
      team: {
        id: MOCK_CS2_MOUZ_TEAM_ID,
        name: "MOUZ",
        shortName: "MOUZ",
        logoUrl: "/cs2-api/mock-assets/mouz.svg",
      },
      seriesScore: 1,
    },
  ],
  competition: mockCompetition,
  format: 3,
  scheduledStartTime: "2026-08-27T18:30:00.000Z",
  lifecycle: "upcoming",
};

export const mockCs2MouzSeriesDetail: Cs2SeriesDetail = {
  ...mockCs2MouzSeriesSummary,
  maps: [
    { state: "pending", seriesMatchIndex: 1 },
    { state: "pending", seriesMatchIndex: 2 },
    { state: "pending", seriesMatchIndex: 3 },
  ],
};

export const mockCs2LaterSeriesSummary: Cs2SeriesSummary = {
  id: "10000000-0000-4000-8000-000000000011",
  availability: "soon",
  participants: [
    mockCs2SeriesSummary.participants[0],
    mockCs2MouzSeriesSummary.participants[1],
  ],
  competition: mockCompetition,
  format: 3,
  scheduledStartTime: "2026-08-27T20:00:00.000Z",
  lifecycle: "upcoming",
};

export const mockCs2TomorrowSeriesSummary: Cs2SeriesSummary = {
  id: "10000000-0000-4000-8000-000000000012",
  availability: "soon",
  participants: [
    {
      ...mockCs2SeriesSummary.participants[1],
      displayOrder: 1,
    },
    {
      ...mockCs2UpcomingSeriesSummary.participants[0],
      displayOrder: 2,
    },
  ],
  competition: mockCompetition,
  format: 3,
  scheduledStartTime: "2026-08-28T15:00:00.000Z",
  lifecycle: "upcoming",
};

const pendingMaps: Cs2SeriesDetail["maps"] = [
  { state: "pending", seriesMatchIndex: 1 },
  { state: "pending", seriesMatchIndex: 2 },
  { state: "pending", seriesMatchIndex: 3 },
];

export const mockCs2LaterSeriesDetail: Cs2SeriesDetail = {
  ...mockCs2LaterSeriesSummary,
  maps: pendingMaps,
};

export const mockCs2TomorrowSeriesDetail: Cs2SeriesDetail = {
  ...mockCs2TomorrowSeriesSummary,
  maps: pendingMaps,
};

export const mockCs2Series = [
  mockCs2SeriesSummary,
  mockCs2UpcomingSeriesSummary,
  mockCs2MouzSeriesSummary,
  mockCs2LaterSeriesSummary,
  mockCs2TomorrowSeriesSummary,
];
export const mockCs2SeriesDetails = [
  mockCs2SeriesDetail,
  mockCs2UpcomingSeriesDetail,
  mockCs2MouzSeriesDetail,
  mockCs2LaterSeriesDetail,
  mockCs2TomorrowSeriesDetail,
];

export const mockUser: User = {
  id: MOCK_USER_ID,
  walletAddress: "8F1x9y7bV3z6nQpR4sT2uW5xY6zA1bC3dE5fG7hJ9kL",
  username: "fan_alice",
};

export const mockMatch: Match = {
  id: MOCK_MATCH_ID,
  discipline: "soccer",
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
    discipline: "soccer",
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
    discipline: "soccer",
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

export const mockCs2LobbyMatch: Cs2Match = {
  id: MOCK_CS2_LOBBY_MATCH_ID,
  discipline: "cs2",
  seriesId: MOCK_CS2_SERIES_ID,
  seriesMatchIndex: 2,
  startTime: mockCs2SeriesSummary.scheduledStartTime,
  status: "scheduled",
  teamScores: [
    { teamId: MOCK_CS2_TEAM_A_ID, name: "Team Spirit", score: 0 },
    { teamId: MOCK_CS2_TEAM_B_ID, name: "Team Vitality", score: 0 },
  ],
};

export const mockCs2LobbyArena: Arena = {
  id: MOCK_CS2_LOBBY_ARENA_ID,
  matchId: MOCK_CS2_LOBBY_MATCH_ID,
  status: "lobby",
  activePlayersCount: 84,
  entryFeeLamports: 100_000_000,
  prizePoolLamports: 8_400_000_000,
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
    discipline: "soccer",
    windowStartMinute: window.start,
    windowEndMinute: window.end,
    question: `Will there be a shot on target (${window.start}-${window.end}')?`,
    targetEventType: "shot_on_target",
    targetTeam: "any",
    settlementCondition: {
      discipline: "soccer",
      targetEventType: "shot_on_target",
      targetTeam: "any",
      windowStartMinute: window.start,
      windowEndMinute: window.end,
      resolve: "event_in_window",
    },
    status: "pending",
  };
}

export function buildMockCs2Round(roundNumber: number): PredictionRound {
  return {
    id: `10000000-0000-4000-8000-0000000001${String(roundNumber).padStart(2, "0")}`,
    arenaId: MOCK_CS2_LOBBY_ARENA_ID,
    matchId: MOCK_CS2_LOBBY_MATCH_ID,
    discipline: "cs2",
    roundNumber,
    question: "Will Team Spirit win this round?",
    settlementCondition: {
      discipline: "cs2",
      topic: "round_winner",
      params: { targetTeamId: MOCK_CS2_TEAM_A_ID },
      roundNumber,
      resolve: "snapshot_diff",
    },
    status: "pending",
  };
}

export const mockCurrentRound: PredictionRound = buildMockRound(2);
