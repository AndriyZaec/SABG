// B5 seam (build plan §Backend, spec §4.2): B3 needs a question + settlement condition for
// every round it opens, but the real Question Generator (context-aware, rule/template-based)
// isn't built yet. This is the injected interface B5 will implement — B3 only ever depends on
// `QuestionProvider`, never on how questions are produced, so B5 drops in later without B3
// changing.

import type { MatchState, SettlementCondition, TargetEventType, TeamSide } from "@arena/contracts";

export interface QuestionContext {
  matchId: string;
  arenaId: string;
  windowStartMinute: number;
  windowEndMinute: number;
  /** Recent match state, when available — context for a real generator (spec §4.2). Unused by the stub. */
  matchState?: MatchState;
}

export interface GeneratedQuestion {
  question: string;
  targetEventType: TargetEventType;
  targetTeam: TeamSide;
  settlementCondition: SettlementCondition;
}

export interface QuestionProvider {
  generate(ctx: QuestionContext): GeneratedQuestion;
}

/**
 * Deterministic placeholder: always asks about a shot by either team in the window. Good enough
 * to exercise B3's lifecycle end-to-end; not a stand-in for B5's context-aware generation policy
 * (natural questions, avoid trivially-resolved — spec §4.2).
 */
export function createStubQuestionProvider(): QuestionProvider {
  return {
    generate(ctx: QuestionContext): GeneratedQuestion {
      const targetEventType: TargetEventType = "shot";
      const targetTeam: TeamSide = "any";
      return {
        question: `Will there be a shot between ${ctx.windowStartMinute}:00 and ${ctx.windowEndMinute}:00?`,
        targetEventType,
        targetTeam,
        settlementCondition: {
          targetEventType,
          targetTeam,
          windowStartMinute: ctx.windowStartMinute,
          windowEndMinute: ctx.windowEndMinute,
          resolve: "event_in_window",
        },
      };
    },
  };
}
