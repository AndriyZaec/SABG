import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@arena/contracts";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../ingestion/replay.js";
import { MatchStateEngine } from "../match-state/engine.js";
import { RoundEngine } from "../round-engine/engine.js";
import { TARGET_WINDOW_STARTS } from "../round-engine/planner.js";
import { SettlementEngine } from "../settlement/engine.js";
import { createQuestionGenerator } from "../question-generator/engine.js";

const ARENA_ID = "00000000-0000-0000-0000-000000000099";

describe("full pipeline (ingestion -> match state -> round -> settlement -> question generator) over fixture 18179764", () => {
  it("produces a consistent final MatchState and 17 correctly-settled, varied rounds", () => {
    const bus = new MatchSignalBus();

    const matchStateEngine = new MatchStateEngine(FIXTURE_MATCH_ID);
    matchStateEngine.subscribeTo(bus);

    const questionGenerator = createQuestionGenerator();
    questionGenerator.subscribeTo(bus);

    const confirmedEvents: LiveEvent[] = [];
    bus.subscribe((signal) => {
      if (signal.kind === "event" && signal.event.confirmed) confirmedEvents.push(signal.event);
    });

    let settlementEngine: SettlementEngine;
    const roundEngine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
      getMatchState: () => matchStateEngine.snapshot,
      questionProvider: questionGenerator,
      onTransition: (event) => {
        if (event.type !== "lock") return;
        const round = roundEngine.roundsByWindow.get(event.windowStartMinute);
        if (round !== undefined) settlementEngine.onRoundLocked(round);
      },
    });
    settlementEngine = new SettlementEngine(ARENA_ID, {
      onSettled: (event) => {
        roundEngine.markSettled(event.windowStartMinute, event.correctAnswer, event.settledBy);
      },
    });
    roundEngine.subscribeTo(bus);
    settlementEngine.subscribeTo(bus);

    replayFixture(bus, FIXTURE_MATCH_ID);

    expect(matchStateEngine.snapshot).toEqual({
      matchId: FIXTURE_MATCH_ID,
      period: "full_time",
      currentMinute: 96,
      score: { home: 2, away: 1 },
      shots: { home: 12, away: 6 },
      corners: { home: 5, away: 3 },
      cards: { home: 1, away: 1 },
      activeWindowStartMinute: 85,
      possession: "home",
    });

    const rounds = [...roundEngine.roundsByWindow.values()].sort(
      (a, b) => (a.windowStartMinute ?? 0) - (b.windowStartMinute ?? 0),
    );
    expect(rounds.map((r) => r.windowStartMinute)).toEqual(TARGET_WINDOW_STARTS);
    for (const round of rounds) {
      expect(round.status).toBe("settled");
    }

    const distinctTargetTypes = new Set(rounds.map((r) => r.targetEventType));
    expect(distinctTargetTypes.size).toBeGreaterThan(1);

    for (const round of rounds) {
      const matchingEventInWindow = confirmedEvents.some(
        (e) =>
          e.eventType === round.targetEventType &&
          (round.targetTeam === "any" || e.team === round.targetTeam) &&
          e.matchMinute >= (round.windowStartMinute ?? 0) &&
          e.matchMinute <= (round.windowEndMinute ?? 0),
      );

      if (round.settledBy === "early") {
        expect(round.correctAnswer).toBe("yes");
        expect(matchingEventInWindow).toBe(true);
      } else {
        expect(round.settledBy).toBe("window_end");
        expect(round.correctAnswer).toBe("no");
        expect(matchingEventInWindow).toBe(false);
      }
    }
  });
});
