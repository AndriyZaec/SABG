import type { Cs2AnswerSubmission, Cs2RoundView } from "./cs2View.js";

export function roundAnswerState(round: Cs2RoundView, submission: Cs2AnswerSubmission, eliminated: boolean) {
  const currentSubmission = "roundId" in submission && submission.roundId === round.roundId ? submission : undefined;
  const picked = currentSubmission?.status === "submitting" ? currentSubmission.answer : round.myAnswer;
  const survived = !eliminated && picked !== undefined &&
    (picked === round.correctAnswer || round.survivalRuleApplied === "no_correct_answers");
  const correct = picked !== undefined && picked === round.correctAnswer;
  const submitting = currentSubmission?.status === "submitting";
  return { currentSubmission, picked, survived, correct, submitting };
}
