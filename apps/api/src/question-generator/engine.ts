import type { MatchSignal, TargetEventType } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import type { GeneratedQuestion, QuestionContext, QuestionProvider } from "../round-engine/question-provider.js";
import { pickCandidate } from "./candidates.js";
import { renderQuestion } from "./templates.js";

export class QuestionGenerator implements QuestionProvider {
  private readonly substitutionCounts = { home: 0, away: 0 };
  private previousTargetEventType: TargetEventType | undefined;

  generate(ctx: QuestionContext): GeneratedQuestion {
    const { targetEventType, targetTeam } = pickCandidate({
      substitutionCounts: this.substitutionCounts,
      previousTargetEventType: this.previousTargetEventType,
    });
    this.previousTargetEventType = targetEventType;

    return {
      question: renderQuestion(targetEventType, targetTeam, ctx.windowStartMinute, ctx.windowEndMinute, ctx.teamNames),
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
  }

  apply(signal: MatchSignal): void {
    if (signal.kind !== "event") return;
    if (signal.event.eventType !== "substitution" || !signal.event.confirmed) return;
    if (signal.event.team === "any") return;
    this.substitutionCounts[signal.event.team] += 1;
  }

  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }
}

export function createQuestionGenerator(): QuestionGenerator {
  return new QuestionGenerator();
}
