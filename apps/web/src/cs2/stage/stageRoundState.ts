import { cs2ClassicRoundPoints, type AnswerRejectionReason } from "@arena/contracts";
import { classicRoundScoring } from "../classicZone.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "../cs2View.js";
import { roundAnswerState } from "../roundAnswerState.js";

export function stageRoundState(view: Cs2ArenaView, connected: boolean, submission: Cs2AnswerSubmission): {
  kind: "answers" | "result" | "status" | "winner";
  title: string;
  detail: string;
  tone: "yellow" | "green" | "red" | "blue";
  rejection?: AnswerRejectionReason;
} {
  const round = view.round;
  if (view.cancelled) return { kind: "status", title: "ARENA CANCELLED", detail: "Paid entries will be refunded in full.", tone: "blue" };
  if (view.myStatus === "winner") return { kind: "winner", title: "Winner", detail: "", tone: "green" };
  if (view.finished) return { kind: "status", title: "ARENA OVER", detail: "", tone: "blue" };
  if (!connected) return { kind: "status", title: "OFFLINE", detail: "Sign in to play", tone: "blue" };
  if (!round) return { kind: "status", title: "NEXT QUESTION SOON", detail: "Watch the round", tone: "blue" };
  if (view.myStatus === undefined) return { kind: "status", title: "SPECTATING", detail: "You're not in this arena", tone: "blue" };
  const state = roundAnswerState(round, submission, view.myStatus === "eliminated");
  if (round.status === "voided") return { kind: "result", title: "ROUND VOIDED", detail: "No penalty", tone: "blue" };
  if (round.status === "settled") {
    const detail = round.correctAnswer ? `It was ${round.correctAnswer.toUpperCase()}` : "Result pending";
    if (round.survivalRuleApplied === "no_correct_answers") return { kind: "result", title: "NO CORRECT ANSWERS", detail: "All survivors stay in", tone: "blue" };
    if (round.correctAnswer === undefined) return { kind: "result", title: "ROUND SETTLED", detail, tone: "blue" };
    if (classicRoundScoring(view, round.roundNumber)) return {
      kind: "result", title: state.correct ? `+${cs2ClassicRoundPoints(round.roundNumber)}` : "NO POINTS",
      detail, tone: state.correct ? "green" : "red",
    };
    return { kind: "result", title: state.survived ? "SURVIVED" : "OUT", detail, tone: state.survived ? "green" : "red" };
  }
  if (view.myStatus === "eliminated") return { kind: "status", title: "YOU'RE OUT", detail: "There's still plenty of action to test your game sense.", tone: "red" };
  if (round.status === "locked") return { kind: "answers", title: "", detail: "", tone: "blue" };
  if (state.currentSubmission?.status === "rejected") return { kind: "answers", title: "", detail: "", tone: "red", rejection: state.currentSubmission.reason };
  return { kind: "answers", title: "", detail: "", tone: state.picked ? "blue" : "yellow" };
}
