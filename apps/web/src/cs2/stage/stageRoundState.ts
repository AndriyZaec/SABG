import { cs2ClassicRoundPoints, type Answer, type AnswerRejectionReason } from "@arena/contracts";
import { classicRoundScoring } from "../classicZone.js";
import type { Cs2AnswerSubmission, Cs2ArenaView } from "../cs2View.js";
import { roundAnswerState } from "../roundAnswerState.js";

export type StageRoundState =
  | { kind: "terminal"; terminal: "winner" }
  | { kind: "terminal"; terminal: "cancelled" | "finished"; title: string; detail: string }
  | { kind: "answers"; picked: Answer | undefined; submitting: boolean; canAnswer: boolean; plateTone: "yellow" | "blue"; rejection?: string }
  | { kind: "tile"; appearance: "result" | "status"; title: string; detail: string; tone: "green" | "red" | "blue" };

const REJECTION_COPY: Record<AnswerRejectionReason, string> = {
  not_subscribed: "Connection lost. Please reconnect.",
  arena_not_found: "Arena is no longer available.",
  round_not_found: "Question is no longer available.",
  round_locked: "Question closed. Pick wasn't saved.",
  eliminated: "You're out. Pick wasn't saved.",
  not_participant: "An arena entry is required.",
};

export function stageRoundState(view: Cs2ArenaView, connected: boolean, submission: Cs2AnswerSubmission): StageRoundState {
  const round = view.round;
  if (view.cancelled) return { kind: "terminal", terminal: "cancelled", title: "ARENA CANCELLED", detail: "Paid entries will be refunded in full." };
  if (view.myStatus === "winner") return { kind: "terminal", terminal: "winner" };
  if (view.finished) return { kind: "terminal", terminal: "finished", title: "ARENA OVER", detail: "" };
  if (!connected) return { kind: "tile", appearance: "status", title: "OFFLINE", detail: "Sign in to play", tone: "blue" };
  if (!round) return { kind: "tile", appearance: "status", title: "NEXT QUESTION SOON", detail: "Watch the round", tone: "blue" };
  if (view.myStatus === undefined) return { kind: "tile", appearance: "status", title: "SPECTATING", detail: "You're not in this arena", tone: "blue" };

  if (view.myStatus === "eliminated") {
    const eliminatedRound = view.leaderboard.find((row) => row.you)?.eliminatedRound;
    if (round.status !== "settled" || eliminatedRound !== round.roundNumber) {
      return { kind: "tile", appearance: "status", title: "YOU'RE OUT", detail: "There's still plenty of action to test your game sense.", tone: "red" };
    }
  }

  const state = roundAnswerState(round, submission, view.myStatus === "eliminated");
  if (round.status === "voided") return { kind: "tile", appearance: "result", title: "ROUND VOIDED", detail: "No penalty", tone: "blue" };
  if (round.status === "settled") {
    const detail = round.correctAnswer ? `It was ${round.correctAnswer.toUpperCase()}` : "Result pending";
    if (round.survivalRuleApplied === "no_correct_answers") return { kind: "tile", appearance: "result", title: "NO CORRECT ANSWERS", detail: "All survivors stay in", tone: "blue" };
    if (round.correctAnswer === undefined) return { kind: "tile", appearance: "result", title: "ROUND SETTLED", detail, tone: "blue" };
    if (classicRoundScoring(view, round.roundNumber)) return {
      kind: "tile", appearance: "result", title: state.correct ? `+${cs2ClassicRoundPoints(round.roundNumber)}` : "NO POINTS",
      detail, tone: state.correct ? "green" : "red",
    };
    return { kind: "tile", appearance: "result", title: state.survived ? "SURVIVED" : "OUT", detail, tone: state.survived ? "green" : "red" };
  }

  const rejection = state.currentSubmission?.status === "rejected" ? REJECTION_COPY[state.currentSubmission.reason] : undefined;
  const picked = rejection ? undefined : state.picked;
  return {
    kind: "answers", picked, submitting: state.submitting, canAnswer: round.status === "open",
    plateTone: picked || round.status === "locked" ? "blue" : "yellow",
    ...(rejection !== undefined ? { rejection } : {}),
  };
}
