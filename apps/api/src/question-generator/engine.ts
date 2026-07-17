// Question Generator's side-effecting edge: implements the `QuestionProvider` seam the round
// engine depends on (round-engine/question-provider.ts), and separately subscribes to the
// MatchSignalBus purely to track substitutions-per-team — the one triviality-rule input
// `MatchState` doesn't already carry.

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
    // Unattributed events don't move a per-team counter — same treatment as the Settlement
    // Engine (apps/api/src/settlement/engine.ts).
    if (signal.event.team === "any") return;
    this.substitutionCounts[signal.event.team] += 1;
  }

  /** Subscribes to `bus`, applying every published signal. Returns an unsubscribe function. */
  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }
}

export function createQuestionGenerator(): QuestionGenerator {
  return new QuestionGenerator();
}
