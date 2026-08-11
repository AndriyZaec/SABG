// Cs2GameSnapshot stream -> @arena/contracts Cs2MatchSignal[]. Pure reducer, CS2's analog of
// ingestion/match-signal.ts. No I/O — driven one poll at a time by whatever owns the GRID poll
// loop (grid recorder today, a live GameSource in a later step).
//
// Round-boundary detection deliberately does NOT try to read `clock`/`paused` for "freezetime
// ended" (spec §2 "Round Lock"): live data exploration (10s-interval polling against a recorded
// series) showed `paused` only reflects the very first warmup, never toggles again per-round
// after that, and `clock.currentSeconds` jumps between the tail of one round and the start of
// the next inside a single poll gap — freezetime (~15s) is almost always swallowed between two
// polls. The reliable signal is the score itself: cumulative per-player/per-team counters don't
// change during freezetime (nobody can score before the round goes live), so the *first*
// snapshot observed for Round N is a functionally equivalent stand-in for "the snapshot at Round
// N's lock" for diff purposes, even though it may lag the real freezetime-end instant by a few
// seconds. Round boundaries are therefore derived purely from `deriveRoundNumber` (sum of
// scores), not from the clock. Precise real-time lock *timing* (when a live round engine should
// actually open the next question) is a separate concern, deferred to that engine.

import type { Cs2GameSnapshot, Cs2MatchSignal, IsoDateTime, TeamSide } from "@arena/contracts";
import { deriveRoundNumber } from "./snapshot.js";

export interface Cs2TrackerState {
  /** Round number of the last-seen live snapshot; `undefined` before the match goes live. */
  readonly roundNumber: number | undefined;
  /** The first snapshot observed for `roundNumber` — the "at lock" baseline for its diff. */
  readonly lockSnapshot: Cs2GameSnapshot | undefined;
}

export function initialCs2TrackerState(): Cs2TrackerState {
  return { roundNumber: undefined, lockSnapshot: undefined };
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
 * Ordering on a round boundary: `cs2_round_end` (settle the round that just finished) is emitted
 * before `cs2_round_lock` (open the next one) — mirrors spec §7 step 3's "settle N before
 * touching N+1" ordering, even though here both derive from the same poll.
 */
export function trackCs2Poll(
  state: Cs2TrackerState,
  snapshot: Cs2GameSnapshot | undefined,
  timestamp: IsoDateTime,
): { state: Cs2TrackerState; signals: Cs2MatchSignal[] } {
  if (snapshot === undefined) {
    if (state.roundNumber === undefined) return { state, signals: [] }; // still waiting for the match to start
    // The live game just disappeared from GRID's response — spec §4 step 2 / §7 step 3.
    return { state: initialCs2TrackerState(), signals: [{ kind: "cs2_match_end", timestamp }] };
  }

  const signals: Cs2MatchSignal[] = [{ kind: "cs2_snapshot", snapshot, timestamp }];
  const roundNumber = deriveRoundNumber(snapshot);

  if (state.roundNumber === undefined) {
    // First live snapshot ever seen for this match — no prior round to close out.
    signals.push({ kind: "cs2_round_lock", roundNumber, timestamp });
    return { state: { roundNumber, lockSnapshot: snapshot }, signals };
  }

  if (roundNumber === state.roundNumber) {
    return { state, signals }; // same round still in progress — just the raw snapshot
  }

  // Score advanced — the tracked round ended. (If polling gaps let roundNumber skip by more than
  // one, only the immediately-preceding round is closed out here; intermediate rounds have no
  // observed boundary snapshot and are invisible to this reducer — a known GRID data-risk,
  // spec §9.)
  const lockSnapshot = state.lockSnapshot;
  if (lockSnapshot !== undefined) {
    signals.push({
      kind: "cs2_round_end",
      roundNumber: state.roundNumber,
      winner: roundWinner(lockSnapshot, snapshot),
      snapshot,
      timestamp,
    });
  }
  signals.push({ kind: "cs2_round_lock", roundNumber, timestamp });
  return { state: { roundNumber, lockSnapshot: snapshot }, signals };
}
