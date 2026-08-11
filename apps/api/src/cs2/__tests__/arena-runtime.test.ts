// Test: Cs2ArenaRuntime wires Cs2RoundEngine's lifecycle events into elimination
// (settlement/apply-outcome.ts), the leaderboard, and the broadcast/persistence ports — the CS2
// analog of gateway/__tests__/arena-runtime.test.ts. No WS server or database: broadcaster/
// persistence are injectable spies, stores are the same in-memory doubles gateway tests use.

import { describe, expect, it } from "vitest";
import type { Cs2GameSnapshot, PredictionRound, ServerMessage, Uuid } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { createInMemoryRuntimeStores } from "../../gateway/stores/in-memory-stores.js";
import type { GatewayBroadcaster } from "../../gateway/arena-runtime.js";
import { Cs2ArenaRuntime, type Cs2ArenaPersistence } from "../arena-runtime.js";
import type { Cs2QuestionProvider } from "../question-provider.js";
import { defaultCs2FixturePath, loadCs2Fixture } from "../fixture.js";
import { parseSnapshot } from "../snapshot.js";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";

const MATCH_ID = "00000000-0000-0000-0000-0000000000c2";
const ARENA_ID = "00000000-0000-0000-0000-0000000000a2";
const PLAYER_YES: Uuid = "00000000-0000-0000-0000-000000000001";
const PLAYER_NO: Uuid = "00000000-0000-0000-0000-000000000002";
const PLAYER_SILENT: Uuid = "00000000-0000-0000-0000-000000000003";

const clock = (currentSeconds: number, ticking = true) => ({ ticking, currentSeconds });
const snapshot = (a: number, b: number, cs = 90): Cs2GameSnapshot => ({
  teams: [
    { name: "Home", score: a, deaths: 0, weaponKills: [], players: [] },
    { name: "Away", score: b, deaths: 0, weaponKills: [], players: [] },
  ],
  clock: clock(cs),
});

/** Fixed round_winner/home question every round — deterministic settlement: correct iff home's
 *  score increased between lock and round-end. */
function fakeProvider(): Cs2QuestionProvider {
  return {
    generate: (ctx) => ({
      question: `Round ${ctx.roundNumber}?`,
      settlementCondition: {
        discipline: "cs2",
        topic: "round_winner",
        params: { targetTeam: "home" },
        roundNumber: ctx.roundNumber,
        resolve: "snapshot_diff",
      },
    }),
  };
}

function createRecordingBroadcaster(): {
  broadcaster: GatewayBroadcaster;
  broadcasts: ServerMessage[];
  personal: { userId: Uuid; message: ServerMessage }[];
} {
  const broadcasts: ServerMessage[] = [];
  const personal: { userId: Uuid; message: ServerMessage }[] = [];
  return {
    broadcaster: {
      broadcast(_arenaId, message) {
        broadcasts.push(message);
      },
      sendToUser(_arenaId, userId, message) {
        personal.push({ userId, message });
      },
    },
    broadcasts,
    personal,
  };
}

function createRecordingPersistence(): { persistence: Cs2ArenaPersistence; upserts: PredictionRound[]; finished: Uuid[][] } {
  const upserts: PredictionRound[] = [];
  const finished: Uuid[][] = [];
  return {
    persistence: {
      upsertRound(round) {
        upserts.push(round);
      },
      finishArena(_arenaId, winners) {
        finished.push(winners);
      },
    },
    upserts,
    finished,
  };
}

function buildRuntime(playerIds: Uuid[], questionProvider?: Cs2QuestionProvider) {
  const bus = new MatchSignalBus();
  const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, playerIds);
  const { broadcaster, broadcasts, personal } = createRecordingBroadcaster();
  const { persistence, upserts, finished } = createRecordingPersistence();

  const runtime = new Cs2ArenaRuntime({
    matchId: MATCH_ID,
    arenaId: ARENA_ID,
    bus,
    predictionStore,
    arenaPlayerStore,
    roster: playerIds.map((userId, i) => ({ userId, username: `p${i}`, joinedAt: "2026-01-01T00:00:00.000Z" })),
    broadcaster,
    persistence,
    ...(questionProvider !== undefined ? { questionProvider } : {}),
  });

  return { runtime, bus, broadcasts, personal, upserts, finished, arenaPlayerStore };
}

describe("Cs2ArenaRuntime — elimination wiring", () => {
  it("eliminates an incorrect answerer and a non-answerer, keeps a correct answerer active", () => {
    const { runtime, bus, arenaPlayerStore, broadcasts } = buildRuntime([PLAYER_YES, PLAYER_NO, PLAYER_SILENT], fakeProvider());

    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound;
    expect(round1?.roundNumber).toBe(1);

    runtime.submitAnswer(PLAYER_YES, round1!.id, "yes"); // home wins -> correct
    runtime.submitAnswer(PLAYER_NO, round1!.id, "no"); // home wins -> incorrect
    // PLAYER_SILENT never answers -> "missed".

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" }); // locks R1, opens R2

    const after = snapshot(1, 0, 20); // home's score increased -> round_winner/home = "yes"
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: after, timestamp: "t2" });

    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("active");
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("eliminated");
    expect(arenaPlayerStore.getStatus(PLAYER_SILENT)).toBe("eliminated");

    const settleMsg = broadcasts.find((m) => m.type === "round.settle");
    expect(settleMsg).toMatchObject({ type: "round.settle", correctAnswer: "yes", settledBy: "round_end", survivorsCount: 1 });
  });

  it("does not broadcast round.open (deferred to 4b — lockAt contract gap, see file header)", () => {
    const { runtime, broadcasts } = buildRuntime([PLAYER_YES], fakeProvider());
    runtime.openRoundOne("t0");
    expect(broadcasts.some((m) => m.type === "round.open")).toBe(false);
  });

  it("orders round.settle before its own leaderboard.update (mirrors soccer's ArenaRuntime)", () => {
    const { runtime, bus, broadcasts } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    const settleIdx = broadcasts.findIndex((m) => m.type === "round.settle");
    const leaderboardIdx = broadcasts.findIndex((m) => m.type === "leaderboard.update");
    expect(settleIdx).toBeGreaterThanOrEqual(0);
    expect(leaderboardIdx).toBeGreaterThan(settleIdx);
  });

  it("finishes the arena once exactly one player remains active", () => {
    const { runtime, bus, broadcasts, personal, finished } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    const finishMsg = broadcasts.find((m) => m.type === "arena.finished");
    expect(finishMsg).toMatchObject({ type: "arena.finished", winners: [PLAYER_YES] });
    expect(finished).toEqual([[PLAYER_YES]]);
    expect(runtime.finalWinners()).toEqual([PLAYER_YES]);

    const winnerPersonal = personal.filter((p) => p.userId === PLAYER_YES && p.message.type === "player.status" && p.message.status === "winner");
    expect(winnerPersonal.length).toBeGreaterThanOrEqual(1);
  });

  it("a voided round persists as voided but eliminates nobody and never reaches the leaderboard", () => {
    const { runtime, bus, arenaPlayerStore, upserts, broadcasts } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes"); // home never scores -> incorrect
    runtime.submitAnswer(PLAYER_NO, round1.id, "no"); // home never scores -> correct

    // Round 1 locks (opens Round 2), but the match ends before Round 2 ever locks/settles.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 60), timestamp: "t2" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });

    const round2 = upserts.find((r) => r.roundNumber === 2 && r.status === "voided");
    expect(round2).toBeDefined();

    // Nobody's status was touched by the void — Round 1's own settle (fallback diff, score never
    // moved) is what determines outcomes here, not Round 2.
    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("eliminated"); // answered "yes", home never scored
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("active");

    const settleMsgs = broadcasts.filter((m) => m.type === "round.settle");
    expect(settleMsgs).toHaveLength(1); // only Round 1 ever settled — Round 2 has no settle broadcast
  });

  it("finalizes the leaderboard (shared win) when the match ends with more than one player still active — spec §3 tie-break", () => {
    const { runtime, bus, broadcasts, finished } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "no"); // home never scores -> both correct
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "away", snapshot: snapshot(0, 1, 20), timestamp: "t2" });
    // Both players still active (correct on Round 1); Round 2 auto-opened but never locks —
    // the match just ends here, e.g. the Series was decided some other way (data-assumptions #12).
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 1, 60), timestamp: "t3" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t4" });

    const finishMsg = broadcasts.find((m) => m.type === "arena.finished");
    expect(finishMsg).toMatchObject({ type: "arena.finished" });
    if (finishMsg?.type === "arena.finished") {
      expect(finishMsg.winners.sort()).toEqual([PLAYER_NO, PLAYER_YES].sort());
    }
    expect(finished).toEqual([[PLAYER_NO, PLAYER_YES].sort()]);
    expect(runtime.finalWinners()?.sort()).toEqual([PLAYER_NO, PLAYER_YES].sort());
  });

  it("does not double-finalize when the match already finished via the ordinary one-survivor path", () => {
    const { runtime, bus, broadcasts, finished } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes"); // home wins -> correct, sole survivor
    runtime.submitAnswer(PLAYER_NO, round1.id, "no"); // eliminated

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });
    // Already finished (one survivor) before the match itself ends.
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 60), timestamp: "t3" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t4" });

    expect(broadcasts.filter((m) => m.type === "arena.finished")).toHaveLength(1);
    expect(finished).toEqual([[PLAYER_YES]]);
  });
});

describe("Cs2ArenaRuntime — full recorded fixture (real question provider, generic assertions)", () => {
  it("every locked round reaches settle, eliminates the silent player by its own answered round, and stays privacy-safe", () => {
    const { runtime, bus, broadcasts, personal } = buildRuntime([PLAYER_YES, PLAYER_NO, PLAYER_SILENT]);
    const answered = new Set<Uuid>();

    runtime.openRoundOne(loadCs2Fixture(defaultCs2FixturePath())[0]!.receivedAt);

    const maybeAnswer = () => {
      const round = runtime.currentRound;
      if (round === undefined || round.status !== "open" || answered.has(round.id)) return;
      answered.add(round.id);
      runtime.submitAnswer(PLAYER_YES, round.id, "yes");
      runtime.submitAnswer(PLAYER_NO, round.id, "no");
      // PLAYER_SILENT deliberately never answers.
    };
    maybeAnswer();

    let trackerState = initialCs2TrackerState();
    for (const entry of loadCs2Fixture(defaultCs2FixturePath())) {
      const snap = parseSnapshot(entry.raw);
      const { state, signals } = trackCs2Poll(trackerState, snap, entry.receivedAt);
      trackerState = state;
      for (const signal of signals) bus.publish(signal);
      maybeAnswer();
    }

    const locks = broadcasts.filter((m) => m.type === "round.lock");
    const settles = broadcasts.filter((m) => m.type === "round.settle");
    expect(locks.length).toBeGreaterThan(0);
    // Every round this replay locked also settled, except possibly the very last (fixture cuts
    // off mid-round, same caveat round-engine.test.ts documents).
    expect(settles.length).toBeGreaterThanOrEqual(locks.length - 1);

    // Privacy (spec §8): no broadcast or personal message ever carries an individual answer.
    for (const message of [...broadcasts, ...personal.map((p) => p.message)]) {
      expect(message).not.toHaveProperty("answer");
    }

    // The silent player never answers -> "missed" -> eliminated at the very first settle.
    expect(personal.some((p) => p.userId === PLAYER_SILENT && p.message.type === "player.status" && p.message.status === "eliminated")).toBe(true);
  });
});
