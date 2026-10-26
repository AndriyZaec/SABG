import {
  cs2ClassicRoundPoints,
  cs2ClassicZoneAfter,
  renderCs2QuestionShort,
  type Answer,
  type ArenaMode,
  type Cs2TeamIdentity,
  type PredictionResult,
  type PredictionRound,
  type RoundStatus,
  type RoundSurvivalRule,
  type RoundWithPredictions,
  type SettlementCondition,
  type Uuid,
} from "@arena/contracts";
import { formatCs2VoidText, NO_CORRECT_ANSWERS_TEXT } from "../../arena/feedFromRounds.js";
import type { Cs2ArenaView } from "../cs2View.js";

export const FINAL_CIRCLE_FEED_TEXT = "Final Circle — one miss and you're out";

/** A round as the feed needs it, from the rounds history or the live round messages. */
export interface Cs2FeedRound {
  id: Uuid;
  roundNumber: number;
  status: RoundStatus;
  question: string;
  /** Absent only for a void of a round this client never saw open. */
  settlementCondition?: SettlementCondition;
  correctAnswer?: Answer;
  survivalRuleApplied?: RoundSurvivalRule;
  /** The viewer's submitted answer, from the rounds history; live rounds carry none. */
  mine?: { answer: Answer; result?: PredictionResult };
}

/** The viewer's settled result for one round (`player.result`). */
export interface Cs2RoundResult {
  answer: Answer | null;
  result: PredictionResult;
  points: number;
}

export interface Cs2FeedInput {
  mode: ArenaMode;
  teams: readonly Cs2TeamIdentity[];
  rounds: readonly Cs2FeedRound[];
  /** Results that arrived live; anything missing is derived from the rounds history. */
  liveResults: Readonly<Record<Uuid, Cs2RoundResult>>;
  /** The viewer's leaderboard row; absent for spectators or once the runtime released the arena. */
  me?: { score: number; eliminatedRound?: number };
  finalCircleFromRound?: number;
  won: boolean;
  finished: boolean;
  cancelledReason?: string;
}

export type Cs2FeedItem =
  | { kind: "result"; id: string; outcome: "correct" | "wrong" | "missed"; points?: number; detail: string }
  | { kind: "round" | "out" | "final_circle" | "info" | "won"; id: string; text: string };

export function cs2FeedRoundFromHistory({ round, predictions }: RoundWithPredictions, myUserId: Uuid | undefined): Cs2FeedRound {
  const mine = myUserId === undefined ? undefined : predictions.find((p) => p.userId === myUserId);
  return {
    ...cs2FeedRoundFromLive(round),
    ...(mine !== undefined ? { mine: { answer: mine.answer, ...(mine.result !== undefined ? { result: mine.result } : {}) } } : {}),
  };
}

export function cs2FeedRoundFromLive(round: PredictionRound): Cs2FeedRound {
  return {
    id: round.id,
    roundNumber: round.roundNumber ?? 0,
    status: round.status,
    question: round.question,
    settlementCondition: round.settlementCondition,
    ...(round.correctAnswer !== undefined ? { correctAnswer: round.correctAnswer } : {}),
    ...(round.survivalRuleApplied !== undefined ? { survivalRuleApplied: round.survivalRuleApplied } : {}),
  };
}

function shortQuestion(round: Cs2FeedRound, teams: readonly Cs2TeamIdentity[]): string {
  const condition = round.settlementCondition;
  if (condition?.discipline !== "cs2") return round.question;
  try {
    return renderCs2QuestionShort(condition.topic, condition.params, teams);
  } catch {
    return round.question;
  }
}

function inFinalCircle(input: Cs2FeedInput, roundNumber: number): boolean {
  return input.finalCircleFromRound !== undefined && roundNumber >= input.finalCircleFromRound;
}

/** The reload path: the same numbers the server sent live, rebuilt from the history. */
function derivedResult(input: Cs2FeedInput, round: Cs2FeedRound, correctAnswer: Answer): Cs2RoundResult | undefined {
  const { me } = input;
  // Without the viewer's row a missing answer can't be told from "not playing".
  if (me === undefined) return undefined;
  if (me.eliminatedRound !== undefined && round.roundNumber > me.eliminatedRound) return undefined;
  if (round.mine === undefined) return { answer: null, result: "missed", points: 0 };
  const result = round.mine.result ?? (round.mine.answer === correctAnswer ? "correct" : "incorrect");
  const points = result !== "correct" ? 0
    : input.mode === "hardcore" || inFinalCircle(input, round.roundNumber) ? 1
    : cs2ClassicRoundPoints(round.roundNumber);
  return { answer: round.mine.answer, result, points };
}

function resultItem(input: Cs2FeedInput, round: Cs2FeedRound, correctAnswer: Answer, result: Cs2RoundResult): Cs2FeedItem {
  const outcome = result.result === "correct" ? "correct" : result.result === "incorrect" ? "wrong" : "missed";
  const yours = outcome === "wrong" && result.answer !== null ? `, you ${result.answer.toUpperCase()}` : "";
  return {
    kind: "result",
    id: `result-${round.id}`,
    outcome,
    ...(input.mode === "classic" ? { points: result.points } : {}),
    detail: `R${round.roundNumber} · ${shortQuestion(round, input.teams)} · answer ${correctAnswer.toUpperCase()}${yours}`,
  };
}

function outText(input: Cs2FeedInput, roundNumber: number, score: number): string {
  if (input.mode === "hardcore" || inFinalCircle(input, roundNumber)) return "Out";
  return `Out — zone ${cs2ClassicZoneAfter(roundNumber)}, you had ${score}`;
}

/** The CS2 match feed, newest first: one line per round plus the events that matter. Live and reload give the same lines. */
export function buildCs2Feed(input: Cs2FeedInput): Cs2FeedItem[] {
  const items: Cs2FeedItem[] = [];
  let finalCircleShown = false;
  const showFinalCircle = () => {
    if (finalCircleShown || input.finalCircleFromRound === undefined) return;
    finalCircleShown = true;
    items.push({ kind: "final_circle", id: "final-circle", text: FINAL_CIRCLE_FEED_TEXT });
  };

  for (const round of [...input.rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
    if (round.status !== "voided" && round.status !== "settled") continue;
    if (inFinalCircle(input, round.roundNumber)) showFinalCircle();
    if (round.status === "voided") {
      items.push({ kind: "info", id: `void-${round.id}`, text: formatCs2VoidText(round.roundNumber) });
      continue;
    }
    const { correctAnswer } = round;
    if (correctAnswer === undefined) continue;
    const result = input.liveResults[round.id] ?? derivedResult(input, round, correctAnswer);
    items.push(result !== undefined
      ? resultItem(input, round, correctAnswer, result)
      : { kind: "round", id: `round-${round.id}`, text: `R${round.roundNumber} · ${shortQuestion(round, input.teams)} · answer ${correctAnswer.toUpperCase()}` });
    if (round.survivalRuleApplied === "no_correct_answers") {
      items.push({ kind: "info", id: `survival-${round.id}`, text: NO_CORRECT_ANSWERS_TEXT });
    }
    if (input.me !== undefined && input.me.eliminatedRound === round.roundNumber) {
      items.push({ kind: "out", id: "out", text: outText(input, round.roundNumber, input.me.score) });
    }
  }
  // Final Circle has started but none of its rounds has settled yet.
  showFinalCircle();
  if (input.cancelledReason !== undefined) items.push({ kind: "info", id: "cancelled", text: `Arena cancelled (${input.cancelledReason})` });
  if (input.finished) items.push({ kind: "info", id: "arena-finished", text: "Arena finished" });
  if (input.won) items.push({ kind: "won", id: "won", text: "You won!" });
  return items.reverse();
}

/** The feed for what the arena screen currently knows. */
export function cs2FeedForView(view: Cs2ArenaView): Cs2FeedItem[] {
  const me = view.leaderboard.find((row) => row.you);
  return buildCs2Feed({
    mode: view.mode,
    teams: view.teamIdentities,
    rounds: view.rounds,
    liveResults: view.liveResults,
    ...(me !== undefined ? { me: { score: me.score, ...(me.eliminatedRound !== undefined ? { eliminatedRound: me.eliminatedRound } : {}) } } : {}),
    ...(view.finalCircleFromRound !== undefined ? { finalCircleFromRound: view.finalCircleFromRound } : {}),
    won: view.myStatus === "winner",
    finished: view.finished === true,
    ...(view.cancelled !== undefined ? { cancelledReason: view.cancelled.reason } : {}),
  });
}
