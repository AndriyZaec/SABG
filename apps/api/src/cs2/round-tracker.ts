// Cs2GameSnapshot stream -> @arena/contracts Cs2MatchSignal[]. Pure reducer, CS2's analog of
// ingestion/match-signal.ts. No I/O — driven one poll at a time by whatever owns the GRID poll
// loop (grid recorder today, a live GameSource in a later step).
//
// Round Lock (spec §2, "кінець freezetime поточного раунду") is detected directly off the GRID
// clock, via `isRoundLive` (snapshot.ts): `currentSeconds` resets upward by a large jump when a
// new round's live phase starts. A full re-analysis of a recorded map (331 snapshots, 10s poll
// interval) found this signal fires exactly once per round transition with zero false positives
// — see cs2-migration-spec/data-assumptions.md #1-#2 for the verification and its single-fixture
// caveat. (An earlier version of this module used a score-based approximation instead, believing
// the clock signal was unreliable past Round 1 — that belief was wrong; the earlier analysis only
// looked at `paused`, which really is unreliable, not at the `currentSeconds` reset pattern.)
//
// Round End (score increases) and Round Lock (clock resets) are independent events that land on
// different polls: the scoreboard updates the instant a round is won, but the next round's clock
// only resets once its freezetime finishes several seconds later. So per round transition this
// module emits `cs2_round_end` for the round that just finished (as soon as the score changes)
// and, a few polls later, `cs2_round_lock` for the round that just went live (as soon as the
// clock resets) — no longer paired on the same poll as they were in the score-based version.
//
// Fallback: if this reducer's very first poll ever is already mid-round (no prior snapshot to
// compare the clock reset against — e.g. joining the poll stream after the round already went
// live), it does not synthesize a lock for that round. It silently tracks the round in progress
// and waits for the next real clock-reset boundary, rather than guessing a lock time it didn't
// observe.

import type { Cs2GameSnapshot, Cs2MatchSignal, IsoDateTime, TeamSide } from "@arena/contracts";
import { deriveRoundNumber, isRoundLive } from "./snapshot.js";

export interface Cs2TrackerState {
  /** Most recent live snapshot seen, used only to detect the next clock reset. `undefined`
   *  before the match goes live or right after it ends. */
  readonly lastSnapshot: Cs2GameSnapshot | undefined;
  /** Round number of the round currently in progress per the score (`deriveRoundNumber`),
   *  regardless of whether its lock was ever observed. */
  readonly roundInProgress: number | undefined;
  /** The snapshot observed at `roundInProgress`'s lock — the "before" baseline for its
   *  eventual `cs2_round_end` diff. `undefined` if that round's lock was never observed
   *  (fallback case: joined the stream mid-round). */
  readonly lockSnapshot: Cs2GameSnapshot | undefined;
  /** Round number of the last `cs2_round_lock` actually emitted — dedupe guard. */
  readonly lockedRound: number | undefined;
}

export function initialCs2TrackerState(): Cs2TrackerState {
  return { lastSnapshot: undefined, roundInProgress: undefined, lockSnapshot: undefined, lockedRound: undefined };
}

/** Whichever team's score increased between two snapshots. Defensive `"any"` fallback for the
 *  degenerate case where neither (or both, which shouldn't happen) changed. */
function roundWinner(before: Cs2GameSnapshot, after: Cs2GameSnapshot): TeamSide {
  const homeDiff = after.teams[0].score - before.teams[0].score;
  const awayDiff = after.teams[1].score - before.teams[1].score;
  if (homeDiff > awayDiff) return "home";
  if (awayDiff > homeDiff) return "away";
  return "any";
}

/**
 * Feeds one poll's parsed result (`undefined` when there's no live game right now — GRID's
 * `finished:false` filter excluded it, or the match hasn't started/is between maps) through the
 * tracker. Returns every signal this poll produced, in emission order, alongside the new state.
 *
 * Within one poll, `cs2_round_end` (settle the round that just finished) is emitted before
 * `cs2_round_lock` (open the next one) if both happen to land on the same poll — mirrors spec
 * §7 step 3's "settle N before touching N+1" ordering, though in practice the two are detected
 * from different signals (score vs clock) a few polls apart, not on the same poll.
 */
export function trackCs2Poll(
  state: Cs2TrackerState,
  snapshot: Cs2GameSnapshot | undefined,
  timestamp: IsoDateTime,
): { state: Cs2TrackerState; signals: Cs2MatchSignal[] } {
  if (snapshot === undefined) {
    if (state.lastSnapshot === undefined) return { state, signals: [] }; // still waiting for the match to start
    // The live game just disappeared from GRID's response — spec §4 step 2 / §7 step 3.
    return { state: initialCs2TrackerState(), signals: [{ kind: "cs2_match_end", timestamp }] };
  }

  const signals: Cs2MatchSignal[] = [{ kind: "cs2_snapshot", snapshot, timestamp }];
  const currentRoundByScore = deriveRoundNumber(snapshot);
  let nextState = state;

  if (state.roundInProgress === undefined) {
    // First live snapshot ever seen for this match — nothing to close out yet.
    nextState = { ...nextState, roundInProgress: currentRoundByScore };
  } else if (currentRoundByScore !== state.roundInProgress) {
    // Score advanced — the tracked round ended. (If polling gaps let the round number skip by
    // more than one, only the immediately-preceding round is closed out here; intermediate
    // rounds have no observed boundary snapshot and are invisible to this reducer — a known
    // GRID data-risk, spec §9.)
    if (state.lockSnapshot !== undefined) {
      signals.push({
        kind: "cs2_round_end",
        roundNumber: state.roundInProgress,
        winner: roundWinner(state.lockSnapshot, snapshot),
        snapshot,
        timestamp,
      });
    }
    nextState = { ...nextState, roundInProgress: currentRoundByScore };
  }

  if (state.lastSnapshot !== undefined && isRoundLive(state.lastSnapshot, snapshot) && nextState.lockedRound !== currentRoundByScore) {
    signals.push({ kind: "cs2_round_lock", roundNumber: currentRoundByScore, timestamp });
    nextState = { ...nextState, lockSnapshot: snapshot, lockedRound: currentRoundByScore };
  }

  return { state: { ...nextState, lastSnapshot: snapshot }, signals };
}
