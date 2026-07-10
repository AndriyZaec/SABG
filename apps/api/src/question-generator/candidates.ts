// B5 — Question Generator: candidate selection (spec §4.2).
//
// Split in two on purpose:
//  - `eligibleCandidates` is pure and fully deterministic — filtering (substitution cap, anti-repeat)
//    never depends on randomness, only on `substitutionCounts`/`previousTargetEventType`, so it's
//    exhaustively unit-testable without any flakiness.
//  - `pickCandidate` adds the one non-deterministic step: a uniformly random pick from that pool.
//
// This used to be entirely deterministic, keyed off `windowStartMinute` (`windowStartMinute %
// pool.length`) — every match ever replayed asked literally the same question for the same window,
// forever, since nothing seeded the pick by match/arena/time. That's a real product problem (not
// just a testing artifact of restarting the same fixture repeatedly): players who see more than one
// match would learn "window N always asks about Y" outright, since the sequence was 100%
// predictable across every match, not just within one. Knowing the question *type* in advance
// doesn't let you cheat the yes/no outcome (that still depends on real match events), but it made
// the questions feel scripted/robotic rather than "context-aware" (spec §4.2). Product decision:
// true per-run randomness — even replaying the identical arena twice can produce a different
// sequence — chosen over seeding by matchId/arenaId (which would have kept a given arena/match
// reproducible across restarts, at the cost of only fixing the "same match" case, not "same arena,
// same run" case).

import { TARGET_EVENT_TYPES, TEAM_SIDES } from "@arena/contracts";
import type { TargetEventType, TeamSide } from "@arena/contracts";

/** Soccer's substitutions-per-team cap — a team already there can't make a 6th (spec §4.2: avoid trivially-decided questions). */
const MAX_SUBSTITUTIONS_PER_TEAM = 5;

export interface CandidatePickInput {
  substitutionCounts: { home: number; away: number };
  /** The target event type asked in the immediately-preceding round, if any (anti-repeat). */
  previousTargetEventType: TargetEventType | undefined;
}

export interface Candidate {
  targetEventType: TargetEventType;
  targetTeam: TeamSide;
}

/** Full 7 (types) x 3 (teams) cross product — every whitelisted target event x every team side. */
const ALL_CANDIDATES: readonly Candidate[] = TARGET_EVENT_TYPES.flatMap((targetEventType) =>
  TEAM_SIDES.map((targetTeam) => ({ targetEventType, targetTeam })),
);

function isTrivial(candidate: Candidate, substitutionCounts: { home: number; away: number }): boolean {
  if (candidate.targetEventType !== "substitution") return false;
  if (candidate.targetTeam === "any") return false; // "any" is never impossible outright
  return substitutionCounts[candidate.targetTeam] >= MAX_SUBSTITUTIONS_PER_TEAM;
}

/**
 * The pool `pickCandidate` may randomly choose from: every whitelisted (type, team) pair, minus
 * trivially-impossible ones (substitution cap) and, for variety, the immediately-previous round's
 * target type — falling back to the cap-only-filtered pool if that would otherwise leave nothing
 * (never returns an empty pool). Pure and deterministic — exhaustively testable on its own.
 */
export function eligibleCandidates(input: CandidatePickInput): Candidate[] {
  const nonTrivial = ALL_CANDIDATES.filter((c) => !isTrivial(c, input.substitutionCounts));
  const varied = nonTrivial.filter((c) => c.targetEventType !== input.previousTargetEventType);
  return varied.length > 0 ? varied : nonTrivial;
}

/** Uniformly random pick from `eligibleCandidates(input)` — true per-run randomness (see file header). */
export function pickCandidate(input: CandidatePickInput): Candidate {
  const pool = eligibleCandidates(input);
  const index = Math.floor(Math.random() * pool.length);
  return pool[index]!;
}
