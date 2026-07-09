// B5 — Question Generator: pure candidate selection (spec §4.2). No I/O, no bus, no clock —
// deterministic given (windowStartMinute, substitutionCounts, previousTargetEventType), so the
// same inputs always produce the same pick (build_plan: "детерміновано й дешево").

import { TARGET_EVENT_TYPES, TEAM_SIDES } from "@arena/contracts";
import type { TargetEventType, TeamSide } from "@arena/contracts";

/** Soccer's substitutions-per-team cap — a team already there can't make a 6th (spec §4.2: avoid trivially-decided questions). */
const MAX_SUBSTITUTIONS_PER_TEAM = 5;

export interface CandidatePickInput {
  /** Seeds the deterministic pick — the round's own window start minute. */
  windowStartMinute: number;
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
 * Picks the next question's (targetEventType, targetTeam), deterministically seeded by
 * `windowStartMinute`. Filters out trivially-impossible candidates (substitution cap) and, for
 * variety, the immediately-previous round's target type — falling back to the cap-only-filtered
 * pool if that would otherwise leave nothing (never returns an empty candidate set).
 */
export function pickCandidate(input: CandidatePickInput): Candidate {
  const nonTrivial = ALL_CANDIDATES.filter((c) => !isTrivial(c, input.substitutionCounts));

  const varied = nonTrivial.filter((c) => c.targetEventType !== input.previousTargetEventType);
  const pool = varied.length > 0 ? varied : nonTrivial;

  const index = ((input.windowStartMinute % pool.length) + pool.length) % pool.length;
  return pool[index]!;
}
