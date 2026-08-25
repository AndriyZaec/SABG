import type { MatchState, SettlementCondition, TargetEventType, TeamSide } from "@arena/contracts";

export interface QuestionContext {
  matchId: string;
  arenaId: string;
  windowStartMinute: number;
  windowEndMinute: number;
  matchState?: MatchState;
  teamNames?: { home: string; away: string };
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
          discipline: "soccer",
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
