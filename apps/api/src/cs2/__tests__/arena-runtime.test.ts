import { describe, expect, it, vi } from "vitest";
import type { ArenaMode, Cs2GameSnapshot, PredictionRound, ServerMessage, Uuid } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { createInMemoryRuntimeStores } from "../../gateway/stores/in-memory-stores.js";
import type { GatewayBroadcaster } from "../../gateway/arena-runtime.js";
import { Cs2ArenaRuntime, type Cs2ArenaPersistence } from "../arena-runtime.js";
import type { Cs2QuestionProvider } from "../question-provider.js";
import { defaultCs2FixturePath, loadCs2Fixture, parseFixtureSnapshot } from "../fixture.js";
import { initialCs2TrackerState, trackCs2Poll } from "../round-tracker.js";

const MATCH_ID = "00000000-0000-0000-0000-0000000000c2";
const ARENA_ID = "00000000-0000-0000-0000-0000000000a2";
const PLAYER_YES: Uuid = "00000000-0000-0000-0000-000000000001";
const PLAYER_NO: Uuid = "00000000-0000-0000-0000-000000000002";
const PLAYER_SILENT: Uuid = "00000000-0000-0000-0000-000000000003";
const TEAMS = [
  { teamId: "team-a", name: "Team A" },
  { teamId: "team-b", name: "Team B" },
] as const;

const clock = (currentSeconds: number, ticking = true) => ({ ticking, currentSeconds });
const snapshot = (a: number, b: number, cs = 90): Cs2GameSnapshot => ({
  teams: [
    { teamId: "team-a", name: "Team A", score: a, deaths: 0, weaponKills: [], players: [] },
    { teamId: "team-b", name: "Team B", score: b, deaths: 0, weaponKills: [], players: [] },
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
        params: { targetTeamId: "team-a" },
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

function createRecordingPersistence(): {
  persistence: Cs2ArenaPersistence;
  upserts: PredictionRound[];
  finished: Uuid[][];
  finalCircleFrom: number[];
} {
  const upserts: PredictionRound[] = [];
  const finished: Uuid[][] = [];
  const finalCircleFrom: number[] = [];
  return {
    persistence: {
      upsertRound(round) {
        upserts.push(round);
      },
      finishArena(_arenaId, winners) {
        finished.push(winners);
      },
      startFinalCircle(_arenaId, fromRound) {
        finalCircleFrom.push(fromRound);
      },
    },
    upserts,
    finished,
    finalCircleFrom,
  };
}

function buildRuntime(playerIds: Uuid[], questionProvider?: Cs2QuestionProvider, mode: ArenaMode = "hardcore") {
  const bus = new MatchSignalBus();
  const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, playerIds);
  const { broadcaster, broadcasts, personal } = createRecordingBroadcaster();
  const { persistence, upserts, finished, finalCircleFrom } = createRecordingPersistence();
  const setStatus = vi.spyOn(arenaPlayerStore, "setStatus");

  const runtime = new Cs2ArenaRuntime({
    matchId: MATCH_ID,
    arenaId: ARENA_ID,
    mode,
    bus,
    predictionStore,
    arenaPlayerStore,
    roster: playerIds.map((userId, i) => ({ userId, username: `p${i}`, joinedAt: "2026-01-01T00:00:00.000Z" })),
    teams: TEAMS,
    broadcaster,
    persistence,
    ...(questionProvider !== undefined ? { questionProvider } : {}),
  });

  return { runtime, bus, broadcasts, personal, upserts, finished, finalCircleFrom, setStatus, arenaPlayerStore, predictionStore };
}

describe("Cs2ArenaRuntime — elimination wiring", () => {
  it.each([false, true])("keeps incorrect answerers active across no-correct rounds, without forgiving AFK (AFK: %s)", (afk) => {
    const players = Array.from({ length: 5 }, (_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);
    const answerers = afk ? players.slice(0, 4) : players;
    const { runtime, bus, broadcasts, personal, upserts, finished, finalCircleFrom, setStatus, arenaPlayerStore, predictionStore } = buildRuntime(players, fakeProvider());
    const roundIds: Uuid[] = [];
    runtime.openRoundOne("t0");
    for (const roundNumber of [1, 2]) {
      const round = runtime.currentRound!;
      expect(round.roundNumber).toBe(roundNumber);
      roundIds.push(round.id);
      for (const userId of answerers) expect(runtime.submitAnswer(userId, round.id, "no").ok).toBe(true);
      bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(roundNumber - 1, 0), timestamp: "t1" });
      bus.publish({ kind: "cs2_round_lock", roundNumber, timestamp: "t1" });
      bus.publish({ kind: "cs2_round_end", roundNumber, snapshot: snapshot(roundNumber, 0), timestamp: "t2" });
      expect(arenaPlayerStore.getActivePlayerIds(ARENA_ID)).toEqual(answerers);
      for (const userId of answerers) expect(predictionStore.getResult(round.id, userId)).toBe("incorrect");
      expect(runtime.leaderboardSnapshot().filter((p) => p.status === "active").map((p) => p.userId).sort()).toEqual([...answerers].sort());
      expect(runtime.leaderboardSnapshot().every((p) => p.score === 0)).toBe(true);
      expect(broadcasts.find((m) => m.type === "round.settle" && m.roundId === round.id)).toMatchObject({
        correctAnswer: "yes", survivorsCount: answerers.length, survivalRuleApplied: "no_correct_answers",
      });
      expect([...upserts].reverse().find((r) => r.id === round.id)).toMatchObject({ status: "settled", survivalRuleApplied: "no_correct_answers" });
      expect(finished).toEqual([]);
      expect(runtime.finalWinners()).toBeUndefined();
    }
    expect(personal.filter((p) => answerers.includes(p.userId) && p.message.type === "player.status").every((p) => p.message.type === "player.status" && p.message.status === "active")).toBe(true);
    if (afk) {
      expect(arenaPlayerStore.getStatus(players[4]!)).toBe("eliminated");
      expect(runtime.leaderboardSnapshot().find((p) => p.userId === players[4])).toMatchObject({ status: "eliminated", missedCount: 1, eliminatedRound: 1 });
      expect(setStatus).toHaveBeenCalledWith(players[4], "eliminated", roundIds[0]);
    }
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });
    expect(finished).toEqual([answerers]);
    expect(runtime.finalWinners()).toEqual(answerers);
    // Hardcore has no zone and no Final Circle.
    expect(finalCircleFrom).toEqual([]);
    expect(broadcasts.some((m) => m.type === "arena.zone")).toBe(false);
  });

  it("ignores a previously eliminated player's correct answer when rescuing the remaining survivors", () => {
    const { runtime, bus, broadcasts, arenaPlayerStore } = buildRuntime([PLAYER_YES, PLAYER_NO, PLAYER_SILENT], fakeProvider());
    runtime.openRoundOne("t0");
    const first = runtime.currentRound!;
    runtime.submitAnswer(PLAYER_YES, first.id, "no");
    runtime.submitAnswer(PLAYER_NO, first.id, "yes");
    runtime.submitAnswer(PLAYER_SILENT, first.id, "yes");
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    const second = broadcasts.find((m) => m.type === "round.open" && m.round.roundNumber === 2);
    if (second?.type !== "round.open") throw new Error("Round 2 did not open");
    // Answers overlap while round 1 is locked; this player is eliminated before round 2 settles.
    runtime.submitAnswer(PLAYER_YES, second.round.id, "yes");
    runtime.submitAnswer(PLAYER_NO, second.round.id, "no");
    runtime.submitAnswer(PLAYER_SILENT, second.round.id, "no");
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0), timestamp: "t2" });
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0), timestamp: "t3" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 2, timestamp: "t3" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 2, snapshot: snapshot(2, 0), timestamp: "t4" });
    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("eliminated");
    expect(arenaPlayerStore.getActivePlayerIds(ARENA_ID)).toEqual([PLAYER_NO, PLAYER_SILENT]);
    expect(runtime.finalWinners()).toBeUndefined();
    expect(broadcasts.find((m) => m.type === "round.settle" && m.roundId === second.round.id)).toMatchObject({ survivalRuleApplied: "no_correct_answers" });
  });

  it.each([true, false])("keeps existing last-survivor/all-AFK finalization (one wrong answer: %s)", (answered) => {
    const { runtime, bus, broadcasts, finished, personal } = buildRuntime([PLAYER_YES, PLAYER_SILENT], fakeProvider());
    runtime.openRoundOne("t0");
    const round = runtime.currentRound!;
    if (answered) runtime.submitAnswer(PLAYER_YES, round.id, "no");
    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(0, 0), timestamp: "t1" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 1, timestamp: "t1" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0), timestamp: "t2" });
    expect(finished).toEqual([answered ? [PLAYER_YES] : [PLAYER_YES, PLAYER_SILENT]]);
    const message = broadcasts.find((m) => m.type === "round.settle");
    if (answered) expect(message).toMatchObject({ survivalRuleApplied: "no_correct_answers", survivorsCount: 1 });
    else expect(message).not.toHaveProperty("survivalRuleApplied");
    expect(personal).toContainEqual({ userId: PLAYER_SILENT, message: { type: "player.status", status: "eliminated", roundId: round.id } });
  });

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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: after, timestamp: "t2" });

    expect(arenaPlayerStore.getStatus(PLAYER_YES)).toBe("active");
    expect(arenaPlayerStore.getStatus(PLAYER_NO)).toBe("eliminated");
    expect(arenaPlayerStore.getStatus(PLAYER_SILENT)).toBe("eliminated");

    const settleMsg = broadcasts.find((m) => m.type === "round.settle");
    expect(settleMsg).toMatchObject({ type: "round.settle", correctAnswer: "yes", settledBy: "round_end", survivorsCount: 1 });
    expect(settleMsg).not.toHaveProperty("survivalRuleApplied");
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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });

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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });

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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });

    const round2Voided = upserts.find((r) => r.roundNumber === 2 && r.status === "voided");
    expect(round2Voided).toBeDefined();
    expect(broadcasts.find((m) => m.type === "round.void")).toEqual({ type: "round.void", roundId: round2Voided!.id, roundNumber: 2 });

    const settlesBefore = broadcasts.filter((m) => m.type === "round.settle").length;

    bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(1, 0, 105), timestamp: "t3" });
    bus.publish({ kind: "cs2_round_lock", roundNumber: 2, timestamp: "t3" });
    bus.publish({ kind: "cs2_round_end", roundNumber: 2, snapshot: snapshot(2, 0, 20), timestamp: "t4" });

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

    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });

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
      { type: "round.void", roundId: round1Voided!.id, roundNumber: 1 },
      { type: "round.void", roundId: round2!.id, roundNumber: 2 },
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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(0, 1, 20), timestamp: "t2" });
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
    bus.publish({ kind: "cs2_round_end", roundNumber: 1, snapshot: snapshot(1, 0, 20), timestamp: "t2" });
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
      const snap = parseFixtureSnapshot(entry.raw);
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

describe("Cs2ArenaRuntime — classic mode", () => {
  const A: Uuid = "00000000-0000-0000-0000-00000000000a";
  const B: Uuid = "00000000-0000-0000-0000-00000000000b";
  const C: Uuid = "00000000-0000-0000-0000-00000000000c";

  /** Team A wins every round, so "yes" is always correct. Each entry maps a player to its answer (absent = missed). */
  function playClassic(players: Uuid[], rounds: Array<Partial<Record<Uuid, "yes" | "no">>>) {
    const ctx = buildRuntime(players, fakeProvider(), "classic");
    ctx.runtime.openRoundOne("t0");
    const roundIds: Uuid[] = [];
    rounds.forEach((answers, i) => {
      const roundNumber = i + 1;
      const round = ctx.runtime.currentRound!;
      expect(round.roundNumber).toBe(roundNumber);
      roundIds.push(round.id);
      for (const [userId, answer] of Object.entries(answers)) ctx.runtime.submitAnswer(userId, round.id, answer!);
      ctx.bus.publish({ kind: "cs2_snapshot", snapshot: snapshot(roundNumber - 1, 0), timestamp: "t1" });
      ctx.bus.publish({ kind: "cs2_round_lock", roundNumber, timestamp: "t1" });
      ctx.bus.publish({ kind: "cs2_round_end", roundNumber, snapshot: snapshot(roundNumber, 0), timestamp: "t2" });
    });
    return { ...ctx, roundIds };
  }

  const score = (runtime: Cs2ArenaRuntime, userId: Uuid) => runtime.leaderboardSnapshot().find((e) => e.userId === userId)?.score;

  it("sends the server's zone after each settle, never the zone of a round that is open but unsettled", () => {
    const rounds = Array.from({ length: 9 }, () => ({ [A]: "yes" as const, [B]: "yes" as const }));
    const { broadcasts, runtime } = playClassic([A, B], rounds);
    const zones = broadcasts.filter((m) => m.type === "arena.zone");
    expect(zones).toHaveLength(9);
    expect(zones[4]).toEqual({ type: "arena.zone", stage: "zone", zone: 0, nextZone: 1 });
    expect(zones[7]).toEqual({ type: "arena.zone", stage: "zone", zone: 4, nextZone: 5 });
    expect(zones[8]).toEqual({ type: "arena.zone", stage: "zone", zone: 5, nextZone: 6 });
    // R10 is open now; the last zone still describes R9.
    expect(runtime.currentRound?.roundNumber).toBe(10);
  });

  it("keeps a wrong answerer active through the warm-up, counts the double round 1, and lets them answer the next round", () => {
    const { runtime, arenaPlayerStore } = playClassic([A, B], [{ [A]: "yes", [B]: "no" }, { [A]: "yes", [B]: "no" }]);
    expect(arenaPlayerStore.getStatus(B)).toBe("active");
    expect(score(runtime, A)).toBe(3);
    expect(score(runtime, B)).toBe(0);
    expect(runtime.submitAnswer(B, runtime.currentRound!.id, "yes").ok).toBe(true);
  });

  it("eliminates a player who falls below the zone at R8 and tells them", () => {
    const rounds = Array.from({ length: 8 }, (_, i) => ({ [A]: "yes" as const, [B]: "yes" as const, [C]: i === 0 ? "yes" as const : "no" as const }));
    const { runtime, arenaPlayerStore, personal, roundIds, setStatus } = playClassic([A, B, C], rounds);
    // C: 2 points after R1, then nothing; zone after R7 = 2, after R8 = 4.
    expect(score(runtime, C)).toBe(2);
    expect(arenaPlayerStore.getStatus(C)).toBe("eliminated");
    expect(setStatus).toHaveBeenCalledWith(C, "eliminated", roundIds[7]);
    expect(runtime.leaderboardSnapshot().find((e) => e.userId === C)?.eliminatedRound).toBe(8);
    expect(personal).toContainEqual({ userId: C, message: { type: "player.status", status: "eliminated", roundId: roundIds[7] } });
    expect(personal.some((p) => p.userId === C && p.message.type === "player.status" && p.message.status === "eliminated" && p.message.roundId !== roundIds[7])).toBe(false);
    expect(runtime.finalWinners()).toBeUndefined();
  });

  it("starts Final Circle once when the zone would empty the field with tied leaders, then a wrong answer eliminates", () => {
    // Nobody scores, so zone 1 after R6 would eliminate everyone; A and B tie at 0 and survive.
    const warmup = Array.from({ length: 6 }, () => ({ [A]: "no" as const, [B]: "no" as const }));
    const { broadcasts, finished, finalCircleFrom, runtime } = playClassic([A, B], [...warmup, { [A]: "yes", [B]: "no" }]);
    const zones = broadcasts.filter((m) => m.type === "arena.zone");
    // R6 started Final Circle, so R7 is its first round; every later settle repeats it.
    expect(zones.slice(5)).toEqual([
      { type: "arena.zone", stage: "final_circle", fromRound: 7 },
      { type: "arena.zone", stage: "final_circle", fromRound: 7 },
    ]);
    expect(finalCircleFrom).toEqual([7]);
    const stageAt = broadcasts.findIndex((m) => m.type === "arena.zone" && m.stage === "final_circle");
    const settles = broadcasts.flatMap((m, i) => (m.type === "round.settle" ? [i] : []));
    expect(settles[5]).toBeGreaterThan(stageAt);
    expect(settles[4]).toBeLessThan(stageAt);
    expect(finished).toEqual([[A]]);
    expect(runtime.finalWinners()).toEqual([A]);
  });

  it("lets a single leader win outright when the zone would empty the field, without Final Circle", () => {
    // After R7: A has 3, B has 2. Zone after R8 = 4 puts both below; A alone survives.
    const rounds = [
      { [A]: "yes" as const, [B]: "yes" as const },
      { [A]: "yes" as const, [B]: "no" as const },
      ...Array.from({ length: 6 }, () => ({ [A]: "no" as const, [B]: "no" as const })),
    ];
    const { broadcasts, finished, finalCircleFrom } = playClassic([A, B], rounds);
    expect(broadcasts.some((m) => m.type === "arena.zone" && m.stage === "final_circle")).toBe(false);
    expect(finalCircleFrom).toEqual([]);
    expect(finished).toEqual([[A]]);
  });

  it("makes every remaining player a winner at match end", () => {
    const { bus, finished } = playClassic([A, B, C], [{ [A]: "yes", [B]: "no" }, { [A]: "yes", [B]: "yes" }]);
    bus.publish({ kind: "cs2_match_end", timestamp: "t3" });
    expect(finished).toEqual([[A, B, C]]);
  });
});
