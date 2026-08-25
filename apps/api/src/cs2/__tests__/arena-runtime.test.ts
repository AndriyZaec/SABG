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

    runtime.submitAnswer(PLAYER_YES, round1!.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1!.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    const after = snapshot(1, 0, 20);
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: after, timestamp: "t2" });

    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("active");
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("eliminated");
    expect(arenaPlayerStore.getStatus(PLAYER_SILENT)).toBe("eliminated");

    const settleMsg = broadcasts.find((m) => m.type === "round.settle");
    expect(settleMsg).toMatchObject({ type: "round.settle", correctAnswer: "yes", settledBy: "round_end", survivorsCount: 1 });
  });

  it("broadcasts round.open with the round but no lockAt", () => {
    const { runtime, broadcasts } = buildRuntime([PLAYER_YES], fakeProvider());
    runtime.openRoundOne("t0");

    const openMsg = broadcasts.find((m) => m.type === "round.open");
    expect(openMsg).toBeDefined();
    if (openMsg?.type === "round.open") {
      expect(openMsg.round.roundNumber).toBe(1);
      expect(openMsg.lockAt).toBeUndefined();
    }
  });

  it("returns player status from the arena player store", () => {
    const { runtime, arenaPlayerStore } = buildRuntime([PLAYER_YES], fakeProvider());
    expect(runtime.statusFor(PLAYER_SILENT)).toBeUndefined();
    expect(runtime.statusFor(PLAYER_YES)).toBe("active");
    arenaPlayerStore.setStatus(PLAYER_YES, "eliminated");
    expect(runtime.statusFor(PLAYER_YES)).toBe("eliminated");
  });

  it("rejects an authenticated spectator who is not an active arena participant", () => {
    const { runtime } = buildRuntime([PLAYER_YES], fakeProvider());
    runtime.openRoundOne("t0");

    expect(runtime.submitAnswer(PLAYER_SILENT, runtime.currentRound!.id, "yes")).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  it("rejects a participant whose status is no longer active", () => {
    const { runtime, arenaPlayerStore } = buildRuntime([PLAYER_YES], fakeProvider());
    runtime.openRoundOne("t0");
    arenaPlayerStore.setStatus(PLAYER_YES, "winner");

    expect(runtime.submitAnswer(PLAYER_YES, runtime.currentRound!.id, "yes")).toEqual({
      ok: false,
      reason: "eliminated",
    });
  });

  it("orders round.settle before its own leaderboard.update", () => {
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

  it("voids the already-open next round the instant a winner is decided (single-survivor path), and ignores its subsequent lock/end signals", () => {
    const { runtime, bus, broadcasts, upserts, arenaPlayerStore } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    const round2Voided = upserts.find((r) => r.roundNumber === 2 && r.status === "voided");
    expect(round2Voided).toBeDefined();
    expect(broadcasts.find((m) => m.type === "round.void")).toEqual({ type: "round.void", roundId: round2Voided!.id });

    const settlesBefore = broadcasts.filter((m) => m.type === "round.settle").length;

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 105), timestamp: "t3" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 2, timestamp: "t3" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 2, winner: "home", snapshot: snapshot(2, 0, 20), timestamp: "t4" });

    expect(broadcasts.filter((m) => m.type === "round.settle")).toHaveLength(settlesBefore);
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("eliminated");
  });

  it("pendingPredictionsFor: shows a locked-but-unsettled round the player answered, never includes a round they didn't answer, and is empty once eliminated", () => {
    const { runtime, bus } = buildRuntime([PLAYER_YES, PLAYER_NO, PLAYER_SILENT], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "yes");

    expect(runtime.pendingPredictionsFor(PLAYER_YES)).toEqual([]);

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    expect(runtime.pendingPredictionsFor(PLAYER_YES)).toEqual([
      { roundId: round1.id, question: round1.question, roundNumber: 1, answer: "yes" },
    ]);
    expect(runtime.pendingPredictionsFor(PLAYER_SILENT)).toEqual([]);

    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    expect(runtime.pendingPredictionsFor(PLAYER_YES)).toEqual([]);
    expect(runtime.pendingPredictionsFor(PLAYER_SILENT)).toEqual([]);

    const round2 = runtime.currentRound!;
    expect(round2.roundNumber).toBe(2);
    runtime.submitAnswer(PLAYER_YES, round2.id, "no");
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 105), timestamp: "t3" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 2, timestamp: "t3" });

    expect(runtime.pendingPredictionsFor(PLAYER_YES)).toEqual([
      { roundId: round2.id, question: round2.question, roundNumber: 2, answer: "no" },
    ]);
  });

  it("an unproven final round is voided without eliminating anyone", () => {
    const { runtime, bus, arenaPlayerStore, upserts, broadcasts } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 60), timestamp: "t2" });
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });

    const round1Voided = upserts.find((r) => r.roundNumber === 1 && r.status === "voided");
    const round2 = upserts.find((r) => r.roundNumber === 2 && r.status === "voided");
    expect(round1Voided).toBeDefined();
    expect(round2).toBeDefined();

    // No observed score transition means no trustworthy elimination.
    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("active");
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("active");

    const settleMsgs = broadcasts.filter((m) => m.type === "round.settle");
    expect(settleMsgs).toHaveLength(0);

    expect(broadcasts.filter((m) => m.type === "round.void")).toEqual([
      { type: "round.void", roundId: round1Voided!.id },
      { type: "round.void", roundId: round2!.id },
    ]);
  });

  it("finalizes a shared win when the match ends with multiple active players", () => {
    const { runtime, bus, broadcasts, finished } = buildRuntime([PLAYER_YES, PLAYER_NO], fakeProvider());
    runtime.openRoundOne("t0");
    const round1 = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, round1.id, "no");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "away", snapshot: snapshot(0, 1, 20), timestamp: "t2" });
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
    runtime.submitAnswer(PLAYER_YES, round1.id, "yes");
    runtime.submitAnswer(PLAYER_NO, round1.id, "no");

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 18), timestamp: "t0" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0, 105), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, winner: "home", snapshot: snapshot(1, 0, 20), timestamp: "t2" });
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
    expect(settles.length).toBeGreaterThanOrEqual(locks.length - 1);

    // Messages must not expose an individual answer.
    for (const message of [...broadcasts, ...personal.map((p) => p.message)]) {
      expect(message).not.toHaveProperty("answer");
    }

    expect(personal.some((p) => p.userId === PLAYER_SILENT && p.message.type === "player.status" && p.message.status === "eliminated")).toBe(true);
  });
});
