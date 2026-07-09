// Full-pipeline smoke test: wires Ingestion (B1) -> Match State Engine (B2) -> Round Engine (B3)
// -> Settlement Engine (B4), with the real Question Generator (B5) instead of B3's stub,
// together over recorded fixture 18179764, exactly as live/run.ts wires them. Each engine already
// has its own fixture-integration test asserting on its own boundary
// (ingestion/__tests__/replay.test.ts, match-state/__tests__/engine.test.ts,
// round-engine/__tests__/engine.test.ts, settlement/__tests__/engine.test.ts) — this test's job
// is different: catch wiring/ordering bugs that only show up when all five consume the same bus
// together, and cross-check each engine's settlement decision against the raw event stream
// independently of that engine's own internals.

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

describe("full pipeline (B1 -> B2 -> B3 -> B4 -> B5) over fixture 18179764", () => {
  it("produces a consistent final MatchState and 17 correctly-settled, varied rounds", () => {
    const bus = new MatchSignalBus();

    const matchStateEngine = new MatchStateEngine(FIXTURE_MATCH_ID);
    matchStateEngine.subscribeTo(bus);

    const questionGenerator = createQuestionGenerator();
    questionGenerator.subscribeTo(bus);

    // Independent record of every confirmed target event, captured straight off the bus rather
    // than through any engine's internals — the ground truth the settlement cross-check below
    // compares against.
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

    // 1. Final MatchState (B2) — same values independently verified in match-state/__tests__/engine.test.ts.
    expect(matchStateEngine.snapshot).toEqual({
      matchId: FIXTURE_MATCH_ID,
      period: "full_time",
      currentMinute: 97,
      score: { home: 2, away: 1 },
      shots: { home: 12, away: 6 },
      corners: { home: 5, away: 3 },
      cards: { home: 1, away: 1 },
      activeWindowStartMinute: 85,
      possession: "home",
    });

    // 2. Every non-halftime window produced exactly one round, all the way to settled (B3 + B4).
    const rounds = [...roundEngine.roundsByWindow.values()].sort(
      (a, b) => a.windowStartMinute - b.windowStartMinute,
    );
    expect(rounds.map((r) => r.windowStartMinute)).toEqual(TARGET_WINDOW_STARTS);
    for (const round of rounds) {
      expect(round.status).toBe("settled");
    }

    // B5: the real generator produces varied questions over a real match — not always "shot"
    // like B3's stub — and the settlement pipeline still functions correctly against whichever
    // whitelisted type/team it picks (verified generically in the cross-check below).
    const distinctTargetTypes = new Set(rounds.map((r) => r.targetEventType));
    expect(distinctTargetTypes.size).toBeGreaterThan(1);

    // 3. Cross-check each settlement decision against the independently-captured event stream —
    // this is the part no single engine's own test can verify, since it never sees the "ground
    // truth" event list from outside the engine under test.
    for (const round of rounds) {
      const matchingEventInWindow = confirmedEvents.some(
        (e) =>
          e.eventType === round.targetEventType &&
          (round.targetTeam === "any" || e.team === round.targetTeam) &&
          e.matchMinute >= round.windowStartMinute &&
          e.matchMinute <= round.windowEndMinute,
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
