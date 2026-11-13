import type { ComponentProps } from "react";
import { cs2ClassicZoneAfter, type PendingPrediction } from "@arena/contracts";
import type { Cs2ArenaView, Cs2RoundView, LeaderRow } from "../cs2View.js";
import type { Cs2StageLayout } from "./Cs2StageLayout.js";

type Fixture = Pick<ComponentProps<typeof Cs2StageLayout>, "view" | "connected" | "answerSubmission" | "seriesId" | "teams" | "competition" | "format" | "map">;
const HANDLES = ["fan_GypN2M", "fan_582281", "fan_7Lx", "fan_roundhouse", "fan_8kL0p", "fan_n1ghtshift", "fan_q9", "fan_202611"] as const;

function players(total: number, active: number): LeaderRow[] {
  return Array.from({ length: total }, (_, i) => ({
    userId: `stage-player-${i}`,
    rank: i + 1,
    name: HANDLES[i] ?? `fan_${582281 + i * 73}`,
    score: i === 2 ? 3 : i < active ? Math.max(3, 5 - i) : Math.max(0, 2 - Math.floor((i - active) / 10)),
    status: i < active ? "active" : "eliminated",
    ...(i === 2 ? { you: true } : {}),
    ...(i >= active ? { eliminatedRound: 5 } : {}),
  }));
}

function history(count: number, mixed = false): Cs2ArenaView["rounds"] {
  return Array.from({ length: count }, (_, i) => ({
    id: `stage-r${i + 1}`, roundNumber: i + 1, status: "settled", question: "Will Team Falcons win this round?",
    settlementCondition: { discipline: "cs2", topic: "round_winner", params: { targetTeamId: "team-a" }, roundNumber: i + 1, resolve: "snapshot_diff" },
    correctAnswer: "yes",
    ...(mixed && i % 3 === 2 ? {} : { mine: { answer: mixed && i % 3 === 1 ? "no" : "yes", result: mixed && i % 3 === 1 ? "incorrect" : "correct" } }),
  }));
}

const ROUND: Cs2RoundView = {
  roundId: "stage-r7", roundNumber: 7, status: "open", question: "Will there be a kill with Desert Eagle this round?",
};

// Full live templates from cs2/catalog.ts; contracts' renderCs2QuestionShort is for tickets/feed.
const LONG_TEAM_QUESTION = "Will every player on Team Natus Vincere Junior get a kill this round?";
const LONG_SURVIVOR_QUESTION = "Will Team Natus Vincere Junior have more than 4 survivors this round?";
const LONG_WEAPON_QUESTION = "Will there be a kill with Desert Eagle this round?";
const PENDING: PendingPrediction = { roundId: "stage-r6", roundNumber: 6, question: "Will there be a kill with AWP this round?", answer: "no" };
const LOCKED_ROUND: Cs2ArenaView["rounds"][number] = {
  id: PENDING.roundId, roundNumber: 6, status: "locked", question: PENDING.question,
  settlementCondition: { discipline: "cs2", topic: "weapon_kill", params: { weapon: "awp" }, roundNumber: 6, resolve: "snapshot_diff" },
};

const BASE: Cs2ArenaView = {
  mode: "classic",
  zone: { type: "arena.zone", stage: "zone", zone: cs2ClassicZoneAfter(5), nextZone: cs2ClassicZoneAfter(6) },
  teams: ["Falcons", "TYLOO"],
  teamIdentities: [{ teamId: "team-a", name: "Falcons" }, { teamId: "team-b", name: "TYLOO" }],
  seriesFormat: 3,
  survivors: 12,
  totalPlayers: 24,
  round: ROUND,
  myStatus: "active",
  leaderboard: players(24, 12),
  pendingPredictions: [PENDING],
  rounds: [...history(5, true), LOCKED_ROUND],
  liveResults: {},
};
const LONG_TEAM_VIEW = {
  teams: ["Natus Vincere Junior", "TYLOO"],
  teamIdentities: [{ teamId: "team-a", name: "Natus Vincere Junior" }, { teamId: "team-b", name: "TYLOO" }],
} satisfies Pick<Cs2ArenaView, "teams" | "teamIdentities">;

function fixture(view: Partial<Cs2ArenaView> = {}, rest: Partial<Omit<Fixture, "view">> = {}): Fixture {
  const merged = { ...BASE, ...view };
  if (merged.round) {
    const current = merged.round;
    merged.rounds = [...merged.rounds.filter((round) => round.id !== current.roundId), {
      id: current.roundId, roundNumber: current.roundNumber, status: current.status, question: current.question,
      ...(current.correctAnswer !== undefined ? { correctAnswer: current.correctAnswer } : {}),
      ...(current.myAnswer !== undefined ? { mine: { answer: current.myAnswer } } : {}),
      ...(current.survivalRuleApplied !== undefined ? { survivalRuleApplied: current.survivalRuleApplied } : {}),
    }];
  }
  return { view: merged, connected: true, answerSubmission: { status: "idle" }, seriesId: "stage-series", competition: { name: "BLAST Rivals", shortName: "Rivals" }, format: 3, map: { seriesMatchIndex: 1, mapName: "Mirage" }, ...rest };
}

function reconnectFixture(view: Partial<Cs2ArenaView>): Fixture {
  const round = view.round ?? ROUND;
  return fixture({
    rounds: history(round.roundNumber - 1, true),
    pendingPredictions: round.status === "locked" && round.myAnswer !== undefined
      ? [{ roundId: round.roundId, roundNumber: round.roundNumber, question: round.question, answer: round.myAnswer }]
      : [],
    ...view,
  });
}

export const stageFixtures = {
  "Round open": fixture(),
  "Answered": fixture({ round: { ...ROUND, myAnswer: "yes" } }),
  "Answered No": fixture({ round: { ...ROUND, myAnswer: "no" } }),
  "Submitting": fixture({}, { answerSubmission: { status: "submitting", roundId: ROUND.roundId, answer: "yes" } }),
  "Rejected": fixture({}, { answerSubmission: { status: "rejected", roundId: ROUND.roundId, answer: "yes", reason: "round_locked" } }),
  // Reconnect can restore an older locked round; its settlement updates NEXT until the next round.open.
  "Reconnect · locked": reconnectFixture({ round: { ...ROUND, status: "locked", myAnswer: "no" } }),
  "Reconnect · settled-correct": reconnectFixture({ mode: "hardcore", round: { ...ROUND, status: "settled", myAnswer: "yes", correctAnswer: "yes" } }),
  "Reconnect · settled-wrong": reconnectFixture({ mode: "hardcore", round: { ...ROUND, status: "settled", myAnswer: "no", correctAnswer: "yes" }, myStatus: "eliminated", survivors: 11, leaderboard: BASE.leaderboard.map((row) => row.you ? { ...row, status: "eliminated", eliminatedRound: 7 } : row) }),
  "Reconnect · no correct answers": reconnectFixture({ mode: "hardcore", round: { ...ROUND, status: "settled", myAnswer: "no", correctAnswer: "yes", survivalRuleApplied: "no_correct_answers" } }),
  "Eliminated": fixture({ myStatus: "eliminated", survivors: 11, pendingPredictions: [], leaderboard: BASE.leaderboard.map((row) => row.you ? { ...row, status: "eliminated", eliminatedRound: 5 } : row) }),
  "Spectator": fixture({ myStatus: undefined, pendingPredictions: [], leaderboard: BASE.leaderboard.map((row) => ({ ...row, you: false })) }),
  "Classic zone · double round": fixture({ mode: "classic", zone: { type: "arena.zone", stage: "zone", zone: 5, nextZone: 6 }, round: { ...ROUND, roundId: "stage-r12", roundNumber: 12, question: "Will Team TYLOO win this round?" } }),
  "Reconnect · classic correct": reconnectFixture({ round: { ...ROUND, status: "settled", myAnswer: "yes", correctAnswer: "yes" } }),
  "Reconnect · classic double correct": reconnectFixture({ mode: "classic", round: { ...ROUND, roundNumber: 12, question: "Will a player on Team Falcons get 3 kills this round?", status: "settled", myAnswer: "yes", correctAnswer: "yes" } }),
  "Reconnect · classic double wrong": reconnectFixture({ mode: "classic", round: { ...ROUND, roundNumber: 12, question: "Will a player on Team Falcons get 3 kills this round?", status: "settled", myAnswer: "no", correctAnswer: "yes" } }),
  "Final circle": fixture({ mode: "classic", zone: { type: "arena.zone", stage: "final_circle", fromRound: 7 }, finalCircleFromRound: 7, survivors: 3, leaderboard: players(24, 3) }),
  "Winner": fixture({ myStatus: "winner", finished: true, round: undefined, survivors: 1, pendingPredictions: [], leaderboard: [
    { userId: "stage-player-2", rank: 1, name: HANDLES[2], score: 6, status: "winner", you: true },
    ...BASE.leaderboard.filter((row) => !row.you).map((row, i) => ({ ...row, rank: i + 2, status: "eliminated" as const })),
  ] }),
  "Finished": fixture({ finished: true, myStatus: "eliminated", survivors: 1, pendingPredictions: [], round: { ...ROUND, status: "settled", myAnswer: "no", correctAnswer: "yes" }, leaderboard: BASE.leaderboard.map((row, i) => ({ ...row, status: i === 0 ? "winner" : "eliminated" })) }),
  "Cancelled": fixture({ cancelled: { reason: "insufficient_players" }, round: undefined, pendingPredictions: [] }),
  "No round yet": fixture({ round: undefined, rounds: [], pendingPredictions: [] }),
  "Disconnected": fixture({}, { connected: false }),
  "Signed-out spectator": fixture({ myStatus: undefined, pendingPredictions: [], leaderboard: BASE.leaderboard.map((row) => ({ ...row, you: false })) }, { connected: false }),
  "Teams unknown": fixture({ teams: undefined, teamIdentities: [], seriesFormat: undefined }),
  "Series info · missing": fixture({}, { competition: undefined, format: undefined, map: undefined }),
  "Series info · partial": fixture({}, { competition: { name: "ESL Pro League" }, format: undefined, map: { seriesMatchIndex: 2 } }),
  "Long team names": fixture({ teams: ["Natus Vincere Junior", "Ninjas in Pyjamas"], round: { ...ROUND, question: LONG_TEAM_QUESTION }, teamIdentities: [{ teamId: "team-a", name: "Natus Vincere Junior" }, { teamId: "team-b", name: "Ninjas in Pyjamas" }] }, { teams: [{ name: "Natus Vincere Junior" }, { name: "Ninjas in Pyjamas" }] }),
  "Longest question · open": fixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_TEAM_QUESTION } }),
  "Longest question · submitting": fixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_TEAM_QUESTION } }, { answerSubmission: { status: "submitting", roundId: ROUND.roundId, answer: "yes" } }),
  "Longest question · rejected": fixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_TEAM_QUESTION, myAnswer: "yes" } }, { answerSubmission: { status: "rejected", roundId: ROUND.roundId, answer: "no", reason: "round_locked" } }),
  "Reconnect · longest question locked": reconnectFixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_TEAM_QUESTION, status: "locked", myAnswer: "yes" } }),
  "Reconnect · longest question settled": reconnectFixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_TEAM_QUESTION, status: "settled", myAnswer: "yes", correctAnswer: "yes" } }),
  "Longest survivor question": fixture({ ...LONG_TEAM_VIEW, round: { ...ROUND, question: LONG_SURVIVOR_QUESTION } }),
  "Longest weapon question": fixture({ round: { ...ROUND, question: LONG_WEAPON_QUESTION } }),
  "No pending predictions": fixture({ pendingPredictions: [] }),
  "History · empty": fixture({ rounds: [LOCKED_ROUND] }),
  "One pending prediction": fixture(),
  "NOW · long question": fixture({ pendingPredictions: [{ ...PENDING, question: LONG_TEAM_QUESTION }] }),
  "NOW resolved · offline": fixture({ round: { ...ROUND, roundId: "stage-r8", roundNumber: 8 }, pendingPredictions: [], rounds: [...BASE.rounds.filter((entry) => entry.id !== PENDING.roundId), { ...LOCKED_ROUND, status: "settled", correctAnswer: PENDING.answer, mine: { answer: PENDING.answer, result: "correct" } }] }, { connected: false }),
  "Three pending predictions": fixture({
    pendingPredictions: [{ ...PENDING, roundId: "stage-p4", roundNumber: 4 }, { ...PENDING, roundId: "stage-p5", roundNumber: 5, answer: "yes" }, PENDING],
    rounds: [...history(3), { ...LOCKED_ROUND, id: "stage-p4", roundNumber: 4 }, { ...LOCKED_ROUND, id: "stage-p5", roundNumber: 5 }, LOCKED_ROUND],
  }),
  "3 players": fixture({ totalPlayers: 3, survivors: 3, leaderboard: players(3, 3) }),
  "200 players": fixture({ totalPlayers: 200, survivors: 136, leaderboard: players(200, 136) }),
  "Long results history": fixture({ mode: "classic", round: { ...ROUND, roundId: "stage-r31", roundNumber: 31, question: "Will the score be 12-12 after this round?" }, rounds: history(30, true), pendingPredictions: [] }),
} satisfies Record<string, Fixture>;

export type StageFixtureName = keyof typeof stageFixtures;
