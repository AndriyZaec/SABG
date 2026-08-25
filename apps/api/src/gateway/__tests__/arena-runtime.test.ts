import { describe, expect, it } from "vitest";
import type { Answer, ArenaPlayerStatus, ServerMessage, Uuid } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, loadFixture, defaultFixturePath, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
import { createMatchSignalProducer } from "../../ingestion/match-signal.js";
import { createInMemoryRuntimeStores } from "../stores/in-memory-stores.js";
import { ArenaRuntime, type GatewayBroadcaster } from "../arena-runtime.js";

const ARENA_ID = "00000000-0000-0000-0000-0000000000aa";
const PLAYER_ANSWERS_YES: Uuid = "00000000-0000-0000-0000-000000000001";
const PLAYER_ANSWERS_NO: Uuid = "00000000-0000-0000-0000-000000000002";
const PLAYER_NEVER_ANSWERS: Uuid = "00000000-0000-0000-0000-000000000003";

function createRecordingBroadcaster(scriptAnswers: (roundId: Uuid) => void): {
  broadcaster: GatewayBroadcaster;
  broadcasts: ServerMessage[];
  personal: { userId: Uuid; message: ServerMessage }[];
} {
  const broadcasts: ServerMessage[] = [];
  const personal: { userId: Uuid; message: ServerMessage }[] = [];
  const broadcaster: GatewayBroadcaster = {
    broadcast(_arenaId, message) {
      broadcasts.push(message);
      if (message.type === "round.open") scriptAnswers(message.round.id);
    },
    sendToUser(_arenaId, userId, message) {
      personal.push({ userId, message });
    },
  };
  return { broadcaster, broadcasts, personal };
}

function buildRuntime() {
  const bus = new MatchSignalBus();
  const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, [
    PLAYER_ANSWERS_YES,
    PLAYER_ANSWERS_NO,
    PLAYER_NEVER_ANSWERS,
  ]);

  let runtime!: ArenaRuntime;
  const scriptAnswers = (roundId: Uuid): void => {
    runtime.submitAnswer(PLAYER_ANSWERS_YES, roundId, "yes");
    runtime.submitAnswer(PLAYER_ANSWERS_NO, roundId, "no");
  };
  const { broadcaster, broadcasts, personal } = createRecordingBroadcaster(scriptAnswers);

  runtime = new ArenaRuntime({
    matchId: FIXTURE_MATCH_ID,
    arenaId: ARENA_ID,
    bus,
    predictionStore,
    arenaPlayerStore,
    roster: [
      { userId: PLAYER_ANSWERS_YES, username: "answers-yes", joinedAt: "2024-01-01T00:00:00.000Z" },
      { userId: PLAYER_ANSWERS_NO, username: "answers-no", joinedAt: "2024-01-01T00:00:01.000Z" },
      { userId: PLAYER_NEVER_ANSWERS, username: "never-answers", joinedAt: "2024-01-01T00:00:02.000Z" },
    ],
    broadcaster,
  });

  return { runtime, bus, broadcasts, personal };
}

describe("ArenaRuntime broadcast integration", () => {
  it("emits match.state, then round.open -> round.lock (aggregate only) -> round.settle -> leaderboard.update per round, ending in arena.finished + winner status", () => {
    const { runtime, bus, broadcasts, personal } = buildRuntime();

    replayFixture(bus, FIXTURE_MATCH_ID);

    expect(broadcasts.some((m) => m.type === "match.state")).toBe(true);

    const roundOpens = broadcasts.filter((m) => m.type === "round.open");
    expect(roundOpens.length).toBeGreaterThan(0);

    for (const openMsg of roundOpens) {
      if (openMsg.type !== "round.open") continue;
      const roundId = openMsg.round.id;
      const openIdx = broadcasts.indexOf(openMsg);
      const lockMsg = broadcasts.find((m) => m.type === "round.lock" && m.roundId === roundId);
      const settleMsg = broadcasts.find((m) => m.type === "round.settle" && m.roundId === roundId);

      expect(lockMsg).toBeDefined();
      expect(settleMsg).toBeDefined();
      const lockIdx = broadcasts.indexOf(lockMsg!);
      const settleIdx = broadcasts.indexOf(settleMsg!);
      expect(openIdx).toBeLessThan(lockIdx);
      expect(lockIdx).toBeLessThan(settleIdx);

      // Individual answers must not appear in public lock messages.
      if (lockMsg!.type === "round.lock") {
        expect(lockMsg!.aggregate).toEqual(
          expect.objectContaining({
            yesPct: expect.any(Number),
            noPct: expect.any(Number),
            total: expect.any(Number),
          }),
        );
      }

      const nextOpenIdx = broadcasts.findIndex((m, i) => i > settleIdx && m.type === "round.open");
      const leaderboardAfterSettle = broadcasts.findIndex(
        (m, i) => i > settleIdx && m.type === "leaderboard.update" && (nextOpenIdx === -1 || i < nextOpenIdx),
      );
      if (leaderboardAfterSettle !== -1) {
        expect(leaderboardAfterSettle).toBeGreaterThan(settleIdx);
      }
    }

    expect(broadcasts.some((m) => m.type === "leaderboard.update")).toBe(true);

    // Public messages must never disclose individual answers.
    for (const message of broadcasts) {
      expect(message).not.toHaveProperty("answer");
      expect((message as { answers?: unknown }).answers).toBeUndefined();
    }
    for (const { message } of personal) {
      expect(message).not.toHaveProperty("answer");
    }

    const finishedMsg = broadcasts.find((m) => m.type === "arena.finished");
    expect(finishedMsg).toBeDefined();
    expect(broadcasts.filter((m) => m.type === "arena.finished")).toHaveLength(1);

    if (finishedMsg!.type === "arena.finished") {
      expect(finishedMsg!.winners.length).toBeGreaterThan(0);
      expect(runtime.finalWinners()).toEqual(finishedMsg!.winners);

      const finishedIdx = broadcasts.indexOf(finishedMsg!);
      for (const winnerId of finishedMsg!.winners) {
        const winnerStatusMsgs = personal.filter(
          (p) => p.userId === winnerId && p.message.type === "player.status" && p.message.status === "winner",
        );
        expect(winnerStatusMsgs.length).toBeGreaterThanOrEqual(1);
      }
      expect(finishedIdx).toBeGreaterThanOrEqual(0);
    }

    expect(runtime.matchState.matchId).toBe(FIXTURE_MATCH_ID);
    expect(runtime.leaderboardSnapshot().length).toBe(3);
  });

  it("personal messages are only ever player.status or player.pending, and player.pending carries only well-formed prediction entries", () => {
    const { bus, personal } = buildRuntime();
    replayFixture(bus, FIXTURE_MATCH_ID);

    expect(personal.some((p) => p.message.type === "player.pending")).toBe(true);

    for (const { message } of personal) {
      if (message.type === "player.status") {
        const validStatuses: ArenaPlayerStatus[] = ["active", "eliminated", "winner"];
        expect(validStatuses).toContain(message.status);
      } else if (message.type === "player.pending") {
        for (const prediction of message.predictions) {
          expect(["yes", "no"]).toContain(prediction.answer);
          expect(typeof prediction.question).toBe("string");
          expect(typeof prediction.roundId).toBe("string");
        }
      } else {
        throw new Error(`unexpected personal message type: ${message.type}`);
      }
    }
  });

  it("rejects an answer submitted for an unknown round, and rejects one submitted after lock", () => {
    const { runtime, bus, broadcasts } = buildRuntime();

    const beforeAny: Answer = "yes";
    const unknownRoundId = "00000000-0000-0000-0000-00000000dead";
    expect(runtime.submitAnswer(PLAYER_ANSWERS_YES, unknownRoundId, beforeAny)).toEqual({
      ok: false,
      reason: "round_not_found",
    });

    replayFixture(bus, FIXTURE_MATCH_ID);

    const firstOpen = broadcasts.find((m) => m.type === "round.open");
    if (firstOpen === undefined || firstOpen.type !== "round.open") {
      throw new Error("expected at least one round.open broadcast");
    }
    const result = runtime.submitAnswer(PLAYER_ANSWERS_YES, firstOpen.round.id, "no");
    expect(result).toEqual({ ok: false, reason: "round_locked" });
  });

  it("pendingPredictionsFor: shows a locked-but-unsettled round the player answered, drops it once settled, and never includes a round they didn't answer", () => {
    const bus = new MatchSignalBus();
    const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, [
      PLAYER_ANSWERS_YES,
      PLAYER_NEVER_ANSWERS,
    ]);

    let runtime!: ArenaRuntime;
    const answeredRoundIds = new Set<Uuid>();
    const pendingAtLock: {
      roundId: Uuid;
      pending: ReturnType<ArenaRuntime["pendingPredictionsFor"]>;
      answered: boolean;
      eliminated: boolean;
    }[] = [];
    const broadcaster: GatewayBroadcaster = {
      broadcast(_arenaId, message) {
        if (message.type === "round.open" && runtime.statusFor(PLAYER_ANSWERS_YES) !== "eliminated") {
          runtime.submitAnswer(PLAYER_ANSWERS_YES, message.round.id, "yes");
          answeredRoundIds.add(message.round.id);
        }
        if (message.type === "round.lock") {
          pendingAtLock.push({
            roundId: message.roundId,
            pending: runtime.pendingPredictionsFor(PLAYER_ANSWERS_YES),
            answered: answeredRoundIds.has(message.roundId),
            eliminated: runtime.statusFor(PLAYER_ANSWERS_YES) === "eliminated",
          });
        }
      },
      sendToUser() {},
    };

    runtime = new ArenaRuntime({
      matchId: FIXTURE_MATCH_ID,
      arenaId: ARENA_ID,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster: [
        { userId: PLAYER_ANSWERS_YES, username: "answers-yes", joinedAt: "2024-01-01T00:00:00.000Z" },
        { userId: PLAYER_NEVER_ANSWERS, username: "never-answers", joinedAt: "2024-01-01T00:00:02.000Z" },
      ],
      broadcaster,
    });

    replayFixture(bus, FIXTURE_MATCH_ID);

    expect(pendingAtLock.length).toBeGreaterThan(0);

    for (const { roundId, pending, answered, eliminated } of pendingAtLock) {
      expect(pending.some((p) => p.roundId === roundId)).toBe(answered && !eliminated);
      if (eliminated) expect(pending).toEqual([]);
    }

    expect(pendingAtLock.some(({ pending, eliminated }) => !eliminated && pending.length >= 2)).toBe(true);

    for (const { pending } of pendingAtLock) {
      for (let i = 1; i < pending.length; i++) {
        expect(pending[i]!.windowStartMinute!).toBeGreaterThanOrEqual(pending[i - 1]!.windowStartMinute!);
      }
    }

    expect(runtime.pendingPredictionsFor(PLAYER_NEVER_ANSWERS)).toEqual([]);

    expect(runtime.pendingPredictionsFor(PLAYER_ANSWERS_YES)).toEqual([]);
  });

  it("pushes personal player.pending right after round.lock (adds the round) and settles down to empty by the end, never to a non-answerer", () => {
    const bus = new MatchSignalBus();
    const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, [
      PLAYER_ANSWERS_YES,
      PLAYER_ANSWERS_NO,
      PLAYER_NEVER_ANSWERS,
    ]);

    let runtime!: ArenaRuntime;
    type LogEntry =
      | { kind: "broadcast"; message: ServerMessage }
      | { kind: "personal"; userId: Uuid; message: ServerMessage };
    const log: LogEntry[] = [];
    const answerersByRound = new Map<Uuid, Uuid[]>();

    const broadcaster: GatewayBroadcaster = {
      broadcast(_arenaId, message) {
        log.push({ kind: "broadcast", message });
        if (message.type === "round.open") {
          const answerers: Uuid[] = [];
          if (runtime.statusFor(PLAYER_ANSWERS_YES) !== "eliminated") {
            runtime.submitAnswer(PLAYER_ANSWERS_YES, message.round.id, "yes");
            answerers.push(PLAYER_ANSWERS_YES);
          }
          if (runtime.statusFor(PLAYER_ANSWERS_NO) !== "eliminated") {
            runtime.submitAnswer(PLAYER_ANSWERS_NO, message.round.id, "no");
            answerers.push(PLAYER_ANSWERS_NO);
          }
          answerersByRound.set(message.round.id, answerers);
        }
      },
      sendToUser(_arenaId, userId, message) {
        log.push({ kind: "personal", userId, message });
      },
    };

    runtime = new ArenaRuntime({
      matchId: FIXTURE_MATCH_ID,
      arenaId: ARENA_ID,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster: [
        { userId: PLAYER_ANSWERS_YES, username: "answers-yes", joinedAt: "2024-01-01T00:00:00.000Z" },
        { userId: PLAYER_ANSWERS_NO, username: "answers-no", joinedAt: "2024-01-01T00:00:01.000Z" },
        { userId: PLAYER_NEVER_ANSWERS, username: "never-answers", joinedAt: "2024-01-01T00:00:02.000Z" },
      ],
      broadcaster,
    });

    replayFixture(bus, FIXTURE_MATCH_ID);

    const personalPending = log.filter(
      (e): e is Extract<LogEntry, { kind: "personal" }> => e.kind === "personal" && e.message.type === "player.pending",
    );
    expect(personalPending.length).toBeGreaterThan(0);

    const neverAnswersPending = personalPending.filter((e) => e.userId === PLAYER_NEVER_ANSWERS);
    for (const push of neverAnswersPending) {
      expect(push.message).toEqual({ type: "player.pending", predictions: [] });
      const idx = log.indexOf(push);
      const prev = log[idx - 1];
      expect(prev?.kind === "personal" && prev.userId === PLAYER_NEVER_ANSWERS && prev.message.type === "player.status" && prev.message.status === "eliminated").toBe(true);
    }

    const eliminatedAtIndex = new Map<Uuid, number>();
    for (let i = 0; i < log.length; i++) {
      const entry = log[i]!;
      if (entry.kind === "personal" && entry.message.type === "player.status" && entry.message.status === "eliminated") {
        if (!eliminatedAtIndex.has(entry.userId)) eliminatedAtIndex.set(entry.userId, i);
      }
    }

    for (let i = 0; i < log.length; i++) {
      const entry = log[i]!;
      if (entry.kind !== "broadcast" || entry.message.type !== "round.lock") continue;
      const roundId = entry.message.roundId;
      const expectedAnswerers = answerersByRound.get(roundId) ?? [];
      const next = log.slice(i + 1, i + 1 + expectedAnswerers.length);
      const pushedTo = next.filter(
        (e): e is Extract<LogEntry, { kind: "personal" }> =>
          e !== undefined && e.kind === "personal" && e.message.type === "player.pending",
      );
      expect(pushedTo).toHaveLength(expectedAnswerers.length);
      for (const push of pushedTo) {
        expect(expectedAnswerers).toContain(push.userId);
        if (push.message.type !== "player.pending") continue;
        const pushIndex = log.indexOf(push);
        const wasActiveAtPush = (eliminatedAtIndex.get(push.userId) ?? Infinity) > pushIndex;
        expect(push.message.predictions.some((p) => p.roundId === roundId)).toBe(wasActiveAtPush);
      }
    }

    for (const userId of [PLAYER_ANSWERS_YES, PLAYER_ANSWERS_NO]) {
      const lastForUser = [...personalPending].reverse().find((e) => e.userId === userId);
      expect(lastForUser).toBeDefined();
      expect(lastForUser!.message).toEqual({ type: "player.pending", predictions: [] });
    }
  });

  it("statusFor / submitAnswer: an eliminated player's answer is rejected on a still-open round, an active player's still succeeds", () => {
    const bus = new MatchSignalBus();
    const { predictionStore, arenaPlayerStore } = createInMemoryRuntimeStores(ARENA_ID, [
      PLAYER_ANSWERS_YES,
      PLAYER_ANSWERS_NO,
    ]);
    arenaPlayerStore.setStatus(PLAYER_ANSWERS_NO, "eliminated");

    let capturedRoundId: Uuid | undefined;
    const broadcaster: GatewayBroadcaster = {
      broadcast(_arenaId, message) {
        if (message.type === "round.open") capturedRoundId = message.round.id;
      },
      sendToUser() {},
    };

    const runtime = new ArenaRuntime({
      matchId: FIXTURE_MATCH_ID,
      arenaId: ARENA_ID,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster: [
        { userId: PLAYER_ANSWERS_YES, username: "answers-yes", joinedAt: "2024-01-01T00:00:00.000Z" },
        { userId: PLAYER_ANSWERS_NO, username: "answers-no", joinedAt: "2024-01-01T00:00:01.000Z" },
      ],
      broadcaster,
    });

    expect(runtime.statusFor(PLAYER_ANSWERS_NO)).toBe("eliminated");
    expect(runtime.statusFor(PLAYER_ANSWERS_YES)).toBe("active");
    expect(runtime.statusFor("00000000-0000-0000-0000-00000000dead")).toBeUndefined();

    const producer = createMatchSignalProducer(FIXTURE_MATCH_ID);
    for (const message of loadFixture(defaultFixturePath())) {
      for (const signal of producer.process(message)) {
        bus.publish(signal);
        if (capturedRoundId !== undefined) break;
      }
      if (capturedRoundId !== undefined) break;
    }
    if (capturedRoundId === undefined) throw new Error("expected a round to open");

    expect(runtime.submitAnswer(PLAYER_ANSWERS_NO, capturedRoundId, "yes")).toEqual({
      ok: false,
      reason: "eliminated",
    });
    expect(runtime.submitAnswer(PLAYER_ANSWERS_YES, capturedRoundId, "yes")).toEqual({
      ok: true,
      receivedAt: expect.any(String),
    });
  });

  it("clears a player's pending predictions the instant they're eliminated, even for a round they legitimately answered while still active (round overlap)", () => {
    const { runtime, bus, personal } = buildRuntime();
    replayFixture(bus, FIXTURE_MATCH_ID);

    const eliminatedIndex = personal.findIndex(
      (e) =>
        (e.userId === PLAYER_ANSWERS_YES || e.userId === PLAYER_ANSWERS_NO) &&
        e.message.type === "player.status" &&
        e.message.status === "eliminated",
    );
    expect(eliminatedIndex).toBeGreaterThanOrEqual(0);
    const eliminatedUserId = personal[eliminatedIndex]!.userId;

    const next = personal[eliminatedIndex + 1];
    expect(next?.userId).toBe(eliminatedUserId);
    expect(next?.message).toEqual({ type: "player.pending", predictions: [] });

    expect(runtime.pendingPredictionsFor(eliminatedUserId)).toEqual([]);

    const survivorId = eliminatedUserId === PLAYER_ANSWERS_YES ? PLAYER_ANSWERS_NO : PLAYER_ANSWERS_YES;
    const survivorPending = personal.filter((e) => e.userId === survivorId && e.message.type === "player.pending");
    expect(survivorPending.some((e) => e.message.type === "player.pending" && e.message.predictions.length > 0)).toBe(
      true,
    );
  });
});
