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
import type { Cs2ArenaView } from "../cs2View.js";

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
  me?: { score: number; rank: number; eliminatedRound?: number };
  /** Names of the arena's winners, from the leaderboard; empty until it finishes or without a leaderboard. */
  winners: readonly string[];
  finalCircleFromRound?: number;
  won: boolean;
  finished: boolean;
  cancelledReason?: string;
}

export type Cs2FeedItem =
  | { kind: "result"; id: string; outcome: "correct" | "wrong" | "missed"; points?: number; detail: string }
  | { kind: "round" | "out"; id: string; text: string }
  /** Laid out like a result: a big title, an optional value on the right, a small detail line. */
  | { kind: "event"; id: string; tone: "void" | "won" | "lost" | "neutral" | "final_circle"; title: string; value?: string; detail?: string };

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

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

const WINNER_NAMES_SHOWN = 3;

function winnersText(winners: readonly string[]): string {
  const extra = winners.length - WINNER_NAMES_SHOWN;
  return `winners: ${winners.slice(0, WINNER_NAMES_SHOWN).join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
}

/** The arena's last line: the viewer's win, their place, or a spectator's view of the result. */
function finishedItem(input: Cs2FeedInput): Cs2FeedItem {
  const { me, winners } = input;
  if (input.won) {
    const share = winners.length > 1 ? ` · 1 of ${winners.length} winners` : winners.length === 1 ? " · only winner" : "";
    return { kind: "event", id: "won", tone: "won", title: "You won", ...(me !== undefined ? { value: String(me.score) } : {}), detail: `Arena finished${share}` };
  }
  const parts = [
    ...(me?.eliminatedRound !== undefined ? [`Out in R${me.eliminatedRound}`] : []),
    ...(winners.length > 0 ? [winnersText(winners)] : []),
  ];
  return {
    kind: "event",
    id: "arena-finished",
    tone: me !== undefined ? "lost" : "neutral",
    title: "Arena finished",
    ...(me !== undefined ? { value: ordinal(me.rank) } : {}),
    ...(parts.length > 0 ? { detail: parts.join(" · ") } : {}),
  };
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
    // Final Circle is known only once the previous round settles, so it already covers the question open then.
    items.push({
      kind: "event",
      id: "final-circle",
      tone: "final_circle",
      title: "Final Circle",
      detail: `R${input.finalCircleFromRound} already counts. Others got it right and you didn't? You're out.`,
    });
  };

  for (const round of [...input.rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
    if (round.status !== "voided" && round.status !== "settled") continue;
    if (inFinalCircle(input, round.roundNumber)) showFinalCircle();
    if (round.status === "voided") {
      // A void of a round this client never saw open has no question.
      const question = shortQuestion(round, input.teams);
      items.push({
        kind: "event",
        id: `void-${round.id}`,
        tone: "void",
        title: "Voided",
        value: "—",
        detail: `R${round.roundNumber}${question !== "" ? ` · ${question}` : ""} · not scored`,
      });
      continue;
    }
    const { correctAnswer } = round;
    if (correctAnswer === undefined) continue;
    const result = input.liveResults[round.id] ?? derivedResult(input, round, correctAnswer);
    items.push(result !== undefined
      ? resultItem(input, round, correctAnswer, result)
      : { kind: "round", id: `round-${round.id}`, text: `R${round.roundNumber} · ${shortQuestion(round, input.teams)} · answer ${correctAnswer.toUpperCase()}` });
    if (round.survivalRuleApplied === "no_correct_answers") {
      items.push({ kind: "event", id: `survival-${round.id}`, tone: "neutral", title: "No correct answers", detail: `R${round.roundNumber} · all survivors stay in` });
    }
    if (input.me !== undefined && input.me.eliminatedRound === round.roundNumber) {
      items.push({ kind: "out", id: "out", text: outText(input, round.roundNumber, input.me.score) });
    }
  }
  // Final Circle has started but none of its rounds has settled yet.
  showFinalCircle();
  if (input.cancelledReason !== undefined) {
    items.push({ kind: "event", id: "cancelled", tone: "neutral", title: "Arena cancelled", detail: input.cancelledReason.replaceAll("_", " ") });
  }
  if (input.finished || input.won) items.push(finishedItem(input));
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
    ...(me !== undefined ? { me: { score: me.score, rank: me.rank, ...(me.eliminatedRound !== undefined ? { eliminatedRound: me.eliminatedRound } : {}) } } : {}),
    winners: view.leaderboard.filter((row) => row.status === "winner").map((row) => row.name),
    ...(view.finalCircleFromRound !== undefined ? { finalCircleFromRound: view.finalCircleFromRound } : {}),
    won: view.myStatus === "winner",
    finished: view.finished === true,
    ...(view.cancelled !== undefined ? { cancelledReason: view.cancelled.reason } : {}),
  });
}
