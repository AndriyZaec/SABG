import { describe, expect, it } from "vitest";
import type { PredictionRound } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { RoundEngine } from "../../round-engine/engine.js";
import { SettlementEngine, type PlayerResultEvent, type SettlementEvent } from "../engine.js";
import { createInMemoryArenaPlayerStore } from "../arena-player-store.js";
import { createInMemoryPredictionStore } from "../prediction-store.js";

const ARENA_ID = "00000000-0000-0000-0000-000000000099";
const MATCH_ID = "00000000-0000-0000-0000-000000000010";
const USER_1 = "00000000-0000-0000-0000-000000000001";
const USER_2 = "00000000-0000-0000-0000-000000000002";

function makeRound(overrides: Partial<PredictionRound> = {}): PredictionRound {
  return {
    id: "round-1",
    arenaId: ARENA_ID,
    matchId: MATCH_ID,
    windowStartMinute: 20,
    windowEndMinute: 25,
    question: "Will there be a shot by home between 20:00 and 25:00?",
    targetEventType: "shot",
    targetTeam: "home",
    settlementCondition: {
      targetEventType: "shot",
      targetTeam: "home",
      windowStartMinute: 20,
      windowEndMinute: 25,
      resolve: "event_in_window",
    },
    status: "locked",
    ...overrides,
  };
}

function setup() {
  const predictionStore = createInMemoryPredictionStore();
  const arenaPlayerStore = createInMemoryArenaPlayerStore(ARENA_ID, [USER_1, USER_2]);
  const settled: SettlementEvent[] = [];
  const playerResults: PlayerResultEvent[] = [];
  const engine = new SettlementEngine(ARENA_ID, {
    predictionStore,
    arenaPlayerStore,
    onSettled: (e) => settled.push(e),
    onPlayerResult: (e) => playerResults.push(e),
  });
  return { engine, predictionStore, arenaPlayerStore, settled, playerResults };
}

describe("SettlementEngine", () => {
  it("settles early on a confirmed matching event, before window end", () => {
    const { engine, predictionStore, settled, playerResults } = setup();
    const round = makeRound();
    predictionStore.recordAnswer(round.id, USER_1, "yes"); // will be correct
    predictionStore.recordAnswer(round.id, USER_2, "no"); // will be incorrect

    engine.onRoundLocked(round);
    engine.apply({
      kind: "event",
      event: { id: "e1", matchId: MATCH_ID, eventType: "shot", team: "home", matchMinute: 22, timestamp: "t", confirmed: true },
    });

    expect(settled).toEqual([
      { type: "settle", roundId: round.id, windowStartMinute: 20, correctAnswer: "yes", settledBy: "early" },
    ]);
    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_1, answer: "yes", result: "correct", status: "active" });
    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_2, answer: "no", result: "incorrect", status: "eliminated" });
  });

  it("does not settle early on a non-matching or unconfirmed event, and settles no at window end", () => {
    const { engine, predictionStore, settled, playerResults } = setup();
    const round = makeRound();
    predictionStore.recordAnswer(round.id, USER_1, "no"); // will be correct
    predictionStore.recordAnswer(round.id, USER_2, "yes"); // will be incorrect

    engine.onRoundLocked(round);
    // wrong event type — no early settle
    engine.apply({
      kind: "event",
      event: { id: "e1", matchId: MATCH_ID, eventType: "corner", team: "home", matchMinute: 22, timestamp: "t", confirmed: true },
    });
    // unconfirmed matching event — no early settle
    engine.apply({
      kind: "event",
      event: { id: "e2", matchId: MATCH_ID, eventType: "shot", team: "home", matchMinute: 23, timestamp: "t", confirmed: false },
    });
    expect(settled).toHaveLength(0);

    engine.apply({ kind: "clock", period: "first_half", matchMinute: 25, running: true, timestamp: "t" });

    expect(settled).toEqual([
      { type: "settle", roundId: round.id, windowStartMinute: 20, correctAnswer: "no", settledBy: "window_end" },
    ]);
    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_1, answer: "no", result: "correct", status: "active" });
    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_2, answer: "yes", result: "incorrect", status: "eliminated" });
  });

  it("marks a player who never answered as missed and eliminated", () => {
    const { engine, playerResults } = setup();
    const round = makeRound();
    // USER_1 and USER_2 both never answer.
    engine.onRoundLocked(round);
    engine.apply({ kind: "clock", period: "first_half", matchMinute: 25, running: true, timestamp: "t" });

    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_1, answer: undefined, result: "missed", status: "eliminated" });
    expect(playerResults).toContainEqual({ roundId: round.id, userId: USER_2, answer: undefined, result: "missed", status: "eliminated" });
  });

  it("is idempotent: a duplicate confirmed event or extra clock tick after settling produces no further transitions", () => {
    const { engine, settled, playerResults } = setup();
    const round = makeRound();
    engine.onRoundLocked(round);
    engine.apply({
      kind: "event",
      event: { id: "e1", matchId: MATCH_ID, eventType: "shot", team: "home", matchMinute: 22, timestamp: "t", confirmed: true },
    });
    expect(settled).toHaveLength(1);
    const resultsAfterFirstSettle = playerResults.length;

    // A second confirmed matching event for the same (already-settled) round.
    engine.apply({
      kind: "event",
      event: { id: "e2", matchId: MATCH_ID, eventType: "shot", team: "home", matchMinute: 23, timestamp: "t", confirmed: true },
    });
    // A clock tick past the window end.
    engine.apply({ kind: "clock", period: "first_half", matchMinute: 30, running: true, timestamp: "t" });

    expect(settled).toHaveLength(1); // no additional settle events
    expect(playerResults).toHaveLength(resultsAfterFirstSettle); // no additional player results
  });

  it("replaying fixture 18179764 through Ingestion -> RoundEngine -> SettlementEngine settles all 17 rounds", () => {
    const bus = new MatchSignalBus();

    // Bridge B3 <-> B4 exactly as live/run.ts wires it: forward-declare so each engine's
    // callback can reference the other.
    let settlementEngine: SettlementEngine;
    const roundEngine = new RoundEngine(FIXTURE_MATCH_ID, ARENA_ID, {
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

    const rounds = [...roundEngine.roundsByWindow.values()];
    expect(rounds).toHaveLength(17);
    for (const round of rounds) {
      expect(round.status).toBe("settled");
      expect(round.settledBy === "early" || round.settledBy === "window_end").toBe(true);
      expect(round.correctAnswer === "yes" || round.correctAnswer === "no").toBe(true);
    }
  });
});
