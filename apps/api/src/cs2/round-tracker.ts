// Score changes end rounds; the next clock reset locks the next round. A mid-round first poll does
// not synthesize an unobserved lock.

import type { Cs2GameSnapshot, Cs2MatchSignal, IsoDateTime, TeamSide } from "@arena/contracts";
import { deriveRoundNumber, isRoundLive } from "./snapshot.js";

export interface Cs2TrackerState {
  readonly lastSnapshot: Cs2GameSnapshot | undefined;
  readonly roundInProgress: number | undefined;
  /** Baseline is absent when polling began after the round lock. */
  readonly lockSnapshot: Cs2GameSnapshot | undefined;
  readonly lockedRound: number | undefined;
}

export function initialCs2TrackerState(): Cs2TrackerState {
  return { lastSnapshot: undefined, roundInProgress: undefined, lockSnapshot: undefined, lockedRound: undefined };
}

function roundWinner(before: Cs2GameSnapshot, after: Cs2GameSnapshot): TeamSide {
  const homeDiff = after.teams[0].score - before.teams[0].score;
  const awayDiff = after.teams[1].score - before.teams[1].score;
  if (homeDiff > awayDiff) return "home";
  if (awayDiff > homeDiff) return "away";
  return "any";
}

/** Emits round end before round lock when both are observed in one poll. */
export function trackCs2Poll(
  state: Cs2TrackerState,
  snapshot: Cs2GameSnapshot | undefined,
  timestamp: IsoDateTime,
): { state: Cs2TrackerState; signals: Cs2MatchSignal[] } {
  if (snapshot === undefined) {
    if (state.lastSnapshot === undefined) return { state, signals: [] };
    return { state: initialCs2TrackerState(), signals: [{ kind: "cs2_match_end", timestamp }] };
  }

  const signals: Cs2MatchSignal[] = [{ kind: "cs2_snapshot", snapshot, timestamp }];
  const currentRoundByScore = deriveRoundNumber(snapshot);
  let nextState = state;

  if (state.roundInProgress === undefined) {
    nextState = { ...nextState, roundInProgress: currentRoundByScore };
  } else if (currentRoundByScore !== state.roundInProgress) {
    const roundsAdvanced = currentRoundByScore - state.roundInProgress;
    // A feed gap spanning multiple rounds cannot safely attribute stat changes to one round.
    if (roundsAdvanced === 1 && state.lockSnapshot !== undefined) {
      signals.push({
        kind: "cs2_round_end",
        roundNumber: state.roundInProgress,
        winner: roundWinner(state.lockSnapshot, snapshot),
        snapshot,
        timestamp,
      });
    }
    nextState = {
      ...nextState,
      roundInProgress: currentRoundByScore,
      ...(roundsAdvanced === 1 ? {} : { lockSnapshot: undefined }),
    };
  }

  if (state.lastSnapshot !== undefined && isRoundLive(state.lastSnapshot, snapshot) && nextState.lockedRound !== currentRoundByScore) {
    signals.push({ kind: "cs2_round_lock", roundNumber: currentRoundByScore, timestamp });
    nextState = { ...nextState, lockSnapshot: snapshot, lockedRound: currentRoundByScore };
  }

  return { state: { ...nextState, lastSnapshot: snapshot }, signals };
}
