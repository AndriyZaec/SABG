import { cs2ClassicRoundPoints, cs2ClassicZoneAfter } from "@arena/contracts";
import type { Cs2ArenaView, Cs2RoundView } from "../cs2View.js";
import { stageFixtures } from "./stageFixtures.js";

type Frame = { label: string; fixture: (typeof stageFixtures)[keyof typeof stageFixtures] };

export function stageSequence(run: number, outcome: "correct" | "wrong"): Frame[] {
  const base = stageFixtures["Round open"];
  const current = base.view.round;
  const pending = base.view.pendingPredictions?.[0];
  if (!current || !pending) return [];
  const round: Cs2RoundView = { ...current, roundId: `sequence-${run}-${current.roundNumber}` };
  const prior = { ...pending, roundId: `sequence-${run}-${pending.roundNumber}` };
  const priorHistory = base.view.rounds.find((entry) => entry.id === pending.roundId);
  const past = base.view.rounds.filter((entry) => entry.id !== current.roundId && entry.id !== pending.roundId);
  const record = (question: Cs2RoundView): Cs2ArenaView["rounds"][number] => ({
    id: question.roundId, roundNumber: question.roundNumber, question: question.question, status: question.status,
    settlementCondition: question.roundNumber === round.roundNumber
      ? { discipline: "cs2", topic: "weapon_kill", params: { weapon: "deagle" }, roundNumber: question.roundNumber, resolve: "snapshot_diff" }
      : { discipline: "cs2", topic: "round_winner", params: { targetTeamId: "team-a" }, roundNumber: question.roundNumber, resolve: "snapshot_diff" },
    ...(question.myAnswer ? { mine: { answer: question.myAnswer } } : {}),
    ...(question.correctAnswer ? { correctAnswer: question.correctAnswer } : {}),
  });
  const lockedPrior: Cs2ArenaView["rounds"][number] = {
    ...priorHistory, id: prior.roundId, roundNumber: prior.roundNumber ?? round.roundNumber - 1, question: prior.question, status: "locked",
  };
  const sequenceBoard = base.view.leaderboard.map((row) => row.you ? row : { ...row, score: Math.min(4, row.score) });
  const baseView: Cs2ArenaView = { ...base.view, leaderboard: sequenceBoard, mode: "classic", zone: { type: "arena.zone", stage: "zone", zone: 0, nextZone: 0 }, round, rounds: [...past, lockedPrior, record(round)], pendingPredictions: [prior] };
  const answer = { ...round, myAnswer: "yes" as const };
  const locked = { ...answer, status: "locked" as const };
  const next: Cs2RoundView = { roundId: `sequence-${run}-${round.roundNumber + 1}`, roundNumber: round.roundNumber + 1, question: "Will Team Falcons win this round?", status: "open" };
  const priorAnswer = outcome === "correct" ? prior.answer : prior.answer === "yes" ? "no" : "yes";
  const currentAnswer = outcome === "correct" ? "yes" : "no";
  const priorPoints = outcome === "correct" ? cs2ClassicRoundPoints(lockedPrior.roundNumber) : 0;
  const currentPoints = outcome === "correct" ? cs2ClassicRoundPoints(round.roundNumber) : 0;
  const ranked = (added: number): Cs2ArenaView["leaderboard"] => sequenceBoard
    .map((row) => row.you ? { ...row, score: row.score + added } : row)
    .sort((a, b) => b.score - a.score)
    .map((row, i) => ({ ...row, rank: i + 1 }));
  const nextView: Cs2ArenaView = {
    ...baseView, round: next, leaderboard: ranked(priorPoints),
    zone: { type: "arena.zone", stage: "zone", zone: cs2ClassicZoneAfter(lockedPrior.roundNumber), nextZone: cs2ClassicZoneAfter(round.roundNumber) },
    rounds: [...past, { ...lockedPrior, status: "settled", correctAnswer: priorAnswer, mine: { answer: prior.answer, result: outcome === "correct" ? "correct" : "incorrect" } }, record(locked), record(next)],
    pendingPredictions: [{ roundId: round.roundId, roundNumber: round.roundNumber, question: round.question, answer: "yes" }],
    liveResults: { [prior.roundId]: { answer: prior.answer, result: outcome === "correct" ? "correct" : "incorrect", points: priorPoints } },
  };
  return [
    { label: "Open", fixture: { ...base, view: baseView } },
    { label: "Saving", fixture: { ...base, view: baseView, answerSubmission: { status: "submitting", roundId: round.roundId, answer: "yes" } } },
    { label: "Answered", fixture: { ...base, view: { ...baseView, round: answer, rounds: [...past, lockedPrior, record(answer)] } } },
    { label: `Next question · R${lockedPrior.roundNumber} ${outcome}`, fixture: { ...base, view: nextView } },
    { label: `R${round.roundNumber} ${outcome}`, fixture: { ...base, view: {
      ...nextView, leaderboard: ranked(priorPoints + currentPoints), pendingPredictions: [],
      zone: { type: "arena.zone", stage: "zone", zone: cs2ClassicZoneAfter(round.roundNumber), nextZone: cs2ClassicZoneAfter(next.roundNumber) },
      rounds: [...nextView.rounds.filter((entry) => entry.id !== round.roundId), { ...record(locked), status: "settled", correctAnswer: currentAnswer }],
      liveResults: { ...nextView.liveResults, [round.roundId]: { answer: "yes", result: outcome === "correct" ? "correct" : "incorrect", points: currentPoints } },
    } } },
  ];
}
