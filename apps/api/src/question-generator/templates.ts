// Question Generator: pure question-text rendering (spec §4.2). Two phrasing variants per
// target event type, matching spec's own examples: team-specific ("Will Team A have a shot...")
// and generic ("Will there be a corner...") when targetTeam is "any".

import type { TargetEventType, TeamSide } from "@arena/contracts";

const TEMPLATES: Record<TargetEventType, { any: string; team: string }> = {
  shot: {
    any: "Will there be a shot between {s}:00 and {e}:00?",
    team: "Will the {team} team have a shot between {s}:00 and {e}:00?",
  },
  shot_on_target: {
    any: "Will there be a shot on target between {s}:00 and {e}:00?",
    team: "Will the {team} team have a shot on target between {s}:00 and {e}:00?",
  },
  corner: {
    any: "Will there be a corner between {s}:00 and {e}:00?",
    team: "Will the {team} team win a corner between {s}:00 and {e}:00?",
  },
  card: {
    any: "Will there be a card between {s}:00 and {e}:00?",
    team: "Will the {team} team receive a card between {s}:00 and {e}:00?",
  },
  goal: {
    any: "Will there be a goal between {s}:00 and {e}:00?",
    team: "Will the {team} team score between {s}:00 and {e}:00?",
  },
  penalty: {
    any: "Will there be a penalty between {s}:00 and {e}:00?",
    team: "Will the {team} team be awarded a penalty between {s}:00 and {e}:00?",
  },
  substitution: {
    any: "Will there be a substitution between {s}:00 and {e}:00?",
    team: "Will the {team} team make a substitution between {s}:00 and {e}:00?",
  },
};

/**
 * Renders the natural-language question text for a picked target event type/team (spec §4.2).
 * `teamNames` supplies the real names (e.g. "England"/"Argentina") for the `{team}` slot; falls
 * back to "Home"/"Away" labels when omitted (unseeded fixture, or a caller with no match names
 * in scope) — mirrors `resolveFixtureTeams`'s own fallback (db/seeds/fixture-metadata.ts).
 */
export function renderQuestion(
  targetEventType: TargetEventType,
  targetTeam: TeamSide,
  windowStartMinute: number,
  windowEndMinute: number,
  teamNames?: { home: string; away: string },
): string {
  const variant = targetTeam === "any" ? TEMPLATES[targetEventType].any : TEMPLATES[targetEventType].team;
  const teamLabel =
    targetTeam === "home" ? teamNames?.home ?? "Home" : targetTeam === "away" ? teamNames?.away ?? "Away" : targetTeam;
  return variant
    .replace("{s}", String(windowStartMinute))
    .replace("{e}", String(windowEndMinute))
    .replace("{team}", teamLabel);
}
