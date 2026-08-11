// Discipline-agnostic half of round settlement: given a round's correct answer, score every
// still-active player's prediction and flip their ArenaPlayer status. Extracted out of
// SettlementEngine.settle() (soccer's side-effecting edge), which otherwise bundled this together
// with soccer-only "when does this round settle" timing logic (early-vs-window-end). CS2 needs
// exactly this half — Cs2RoundEngine (cs2/round-engine.ts) already decides *that* and *what* a
// round settled to (snapshot-diff, spec §7), it just has no elimination step of its own. Kept as
// one shared function so the elimination rule (missed -> eliminated, same as incorrect) can't
// quietly diverge between disciplines the way a copy-pasted loop would invite.

import type { Answer, ArenaPlayerStatus, PredictionResult, Uuid } from "@arena/contracts";
import type { PredictionStore } from "./prediction-store.js";
import type { ArenaPlayerStore } from "./arena-player-store.js";

export interface PlayerResultEvent {
  roundId: Uuid;
  userId: Uuid;
  /** The player's submitted answer, or undefined if they never answered (spec §6 "missed"). */
  answer: Answer | undefined;
  result: PredictionResult;
  status: ArenaPlayerStatus;
}

/**
 * Scores every currently-active player of `arenaId` against `correctAnswer` for `roundId`, and
 * eliminates whoever got it wrong or never answered. Mutates `stores` through the injected ports
 * (same seams SettlementEngine already used); `onPlayerResult` fires once per active player, in
 * `getActivePlayerIds`'s order.
 */
export function applyRoundOutcome(
  roundId: Uuid,
  arenaId: Uuid,
  correctAnswer: Answer,
  stores: { predictionStore: PredictionStore; arenaPlayerStore: ArenaPlayerStore },
  onPlayerResult?: (event: PlayerResultEvent) => void,
): void {
  const answers = stores.predictionStore.getAnswers(roundId);

  for (const userId of stores.arenaPlayerStore.getActivePlayerIds(arenaId)) {
    const answer = answers.get(userId);
    const result: PredictionResult = answer === undefined ? "missed" : answer === correctAnswer ? "correct" : "incorrect";
    const status: ArenaPlayerStatus = result === "correct" ? "active" : "eliminated";

    stores.predictionStore.recordResult(roundId, userId, result);
    stores.arenaPlayerStore.setStatus(userId, status);
    onPlayerResult?.({ roundId, userId, answer, result, status });
  }
}
