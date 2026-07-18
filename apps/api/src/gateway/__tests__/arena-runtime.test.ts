// Test: "a real client passes a full round over WS; contract = the mock." No WS
// server or database is involved — the runtime is source-agnostic (driven by a MatchSignalBus)
// and its persistence/broadcast ports are both injectable, so this drives the *real* engine
// pipeline (unchanged) over the same recorded fixture the other engine tests use, via a
// broadcaster spy standing in for a real WS client, and in-memory stores standing in for Postgres.

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

/** Records every broadcast/personal message, and — on round.open — answers as a real client
 *  would (synchronously, matching a WS message handler reacting to the open push). */
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
    // PLAYER_NEVER_ANSWERS deliberately never answers.
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
    // No persistence — kept DB-free.
  });

  return { runtime, bus, broadcasts, personal };
}

describe("ArenaRuntime — B7 DoD: a real client passes full rounds over the broadcast port", () => {
  it("emits match.state, then round.open -> round.lock (aggregate only) -> round.settle -> leaderboard.update per round, ending in arena.finished + winner status", () => {
    const { runtime, bus, broadcasts, personal } = buildRuntime();

    replayFixture(bus, FIXTURE_MATCH_ID);

    // 1. match.state arrives at least once.
    expect(broadcasts.some((m) => m.type === "match.state")).toBe(true);

    // 2. Every round follows the documented per-round order: settle -> leaderboard.update ->
    // (this round's personal statuses interleave after leaderboard.update, checked separately
    // below) — here we assert the broadcast-only subsequence's relative order per round.
    const roundOpens = broadcasts.filter((m) => m.type === "round.open");
    expect(roundOpens.length).toBeGreaterThan(0);

    for (const openMsg of roundOpens) {
      if (openMsg.type !== "round.open") continue;
      const roundId = openMsg.round.id;
      const openIdx = broadcasts.indexOf(openMsg);
      const lockMsg = broadcasts.find((m) => m.type === "round.lock" && m.roundId === roundId);
      const settleMsg = broadcasts.find((m) => m.type === "round.settle" && m.roundId === roundId);

      // Every opened round in this fixture (18179764, full 17-round replay) reaches lock+settle.
      expect(lockMsg).toBeDefined();
      expect(settleMsg).toBeDefined();
      const lockIdx = broadcasts.indexOf(lockMsg!);
      const settleIdx = broadcasts.indexOf(settleMsg!);
      expect(openIdx).toBeLessThan(lockIdx);
      expect(lockIdx).toBeLessThan(settleIdx);

      // Spectator privacy (spec §8): round.lock carries only an aggregate.
      if (lockMsg!.type === "round.lock") {
        expect(lockMsg!.aggregate).toEqual(
          expect.objectContaining({
            yesPct: expect.any(Number),
            noPct: expect.any(Number),
            total: expect.any(Number),
          }),
        );
      }

      // IF this round's settle produced a leaderboard change, it's ordered leaderboard.update
      // after settle (before the next round's open, if any). Not every round produces one: once
      // the arena has already finished, the round/settlement engines mechanically keep
      // opening/settling the fixture's remaining fixed windows with zero active players left,
      // and the leaderboard rightly emits nothing for those (nothing changed) — so existence
      // isn't asserted here, only ordering.
      const nextOpenIdx = broadcasts.findIndex((m, i) => i > settleIdx && m.type === "round.open");
      const leaderboardAfterSettle = broadcasts.findIndex(
        (m, i) => i > settleIdx && m.type === "leaderboard.update" && (nextOpenIdx === -1 || i < nextOpenIdx),
      );
      if (leaderboardAfterSettle !== -1) {
        expect(leaderboardAfterSettle).toBeGreaterThan(settleIdx);
      }
    }

    // 2b. At least one round actually moved the leaderboard (sanity: the assertion above isn't
    // vacuously true because no round ever produced a leaderboard.update).
    expect(broadcasts.some((m) => m.type === "leaderboard.update")).toBe(true);

    // 3. No broadcast message ever carries an individual answer — only aggregates/statuses.
    for (const message of broadcasts) {
      expect(message).not.toHaveProperty("answer");
      expect((message as { answers?: unknown }).answers).toBeUndefined();
    }
    for (const { message } of personal) {
      expect(message).not.toHaveProperty("answer");
    }

    // 4. The arena reaches a definitive finish (one-survivor / zero-survivor / full-time —
    // all three are valid per spec §7, exercised generically here since the actual outcome
    // depends on which windows the fixture's confirmed events happen to fall in).
    const finishedMsg = broadcasts.find((m) => m.type === "arena.finished");
    expect(finishedMsg).toBeDefined();
    expect(broadcasts.filter((m) => m.type === "arena.finished")).toHaveLength(1); // exactly once

    if (finishedMsg!.type === "arena.finished") {
      expect(finishedMsg!.winners.length).toBeGreaterThan(0);
      expect(runtime.finalWinners()).toEqual(finishedMsg!.winners);

      // Personal "winner" player.status sent to every winner, after arena.finished.
      const finishedIdx = broadcasts.indexOf(finishedMsg!);
      for (const winnerId of finishedMsg!.winners) {
        const winnerStatusMsgs = personal.filter(
          (p) => p.userId === winnerId && p.message.type === "player.status" && p.message.status === "winner",
        );
        expect(winnerStatusMsgs.length).toBeGreaterThanOrEqual(1);
      }
      // The finish broadcast is the last arena-wide message this test cares about ordering-wise.
      expect(finishedIdx).toBeGreaterThanOrEqual(0);
    }

    // 5. Reconnect / resync (spec §9): the runtime's snapshot getters reflect final state at any
    // point after the replay — what a WS gateway's "subscribe" handler would resend on connect.
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
        // Structural privacy guarantee (spec §8): pendingPredictionsFor(userId) only ever reads
        // predictionStore.getAnswers(roundId).get(userId) — it cannot surface another user's
        // answer by construction. Here we just assert the payload shape stays well-formed.
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

    // Before any round opens at all, an unknown round id can't resolve.
    const beforeAny: Answer = "yes";
    const unknownRoundId = "00000000-0000-0000-0000-00000000dead";
    expect(runtime.submitAnswer(PLAYER_ANSWERS_YES, unknownRoundId, beforeAny)).toEqual({
      ok: false,
      reason: "round_not_found",
    });

    replayFixture(bus, FIXTURE_MATCH_ID);

    // Every round from this fixture is settled by the end of replay — submitting now for a round
    // that genuinely exists must be rejected as locked, not not_found.
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
    // A real client stops submitting once eliminated (submitAnswer now rejects it anyway) — track
    // which rounds this player actually got an answer in, so lock-time assertions only expect the
    // round in their pending set on rounds they were still active for.
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
            // A round they answered while active can still get excluded by the time it locks: the
            // round overlap means the *previous* round can settle (and eliminate them) in between
            // their answer and this round's own lock — elimination clears pending immediately.
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

    // The round that just locked is in this player's pending set at that moment, provided they
    // actually answered it and haven't since been eliminated by an overlapping round settling.
    for (const { roundId, pending, answered, eliminated } of pendingAtLock) {
      expect(pending.some((p) => p.roundId === roundId)).toBe(answered && !eliminated);
      if (eliminated) expect(pending).toEqual([]);
    }

    // Settlement is per-window, not per-round-in-sequence: this fixture genuinely produces
    // overlap — by the second lock, the prior round is still awaiting settle too. Checked only
    // while still active: the question asked each round is picked at random (by design — see
    // question-generator/candidates.ts), so *when* (or whether) this single player is eliminated
    // varies run to run; once eliminated their pending is correctly forced to empty (asserted
    // above), which would otherwise mask this fixture's real structural overlap.
    expect(pendingAtLock.some(({ pending, eliminated }) => !eliminated && pending.length >= 2)).toBe(true);

    // Whenever more than one is pending, they're ordered by windowStartMinute ascending.
    for (const { pending } of pendingAtLock) {
      for (let i = 1; i < pending.length; i++) {
        expect(pending[i]!.windowStartMinute).toBeGreaterThanOrEqual(pending[i - 1]!.windowStartMinute);
      }
    }

    // A player who never answers never has anything pending, even mid-match.
    expect(runtime.pendingPredictionsFor(PLAYER_NEVER_ANSWERS)).toEqual([]);

    // Once the whole fixture has settled, nothing is left pending for anyone.
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
    // A real client stops submitting once eliminated (submitAnswer now rejects it anyway) — track
    // which of the two players actually answered each round, since only they get pushed to.
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

    // A player who never answers is never pushed a *non-empty* pending list (pushPendingForAnswerers
    // never targets them). They can still get a single empty clearing push the moment they're
    // eliminated (their first-ever settle: "missed" -> eliminated) — always empty, and always right
    // after their own player.status:"eliminated" personal message.
    const neverAnswersPending = personalPending.filter((e) => e.userId === PLAYER_NEVER_ANSWERS);
    for (const push of neverAnswersPending) {
      expect(push.message).toEqual({ type: "player.pending", predictions: [] });
      const idx = log.indexOf(push);
      const prev = log[idx - 1];
      expect(prev?.kind === "personal" && prev.userId === PLAYER_NEVER_ANSWERS && prev.message.type === "player.status" && prev.message.status === "eliminated").toBe(true);
    }

    // First log index, per user, of their own elimination (if any) — used below to tell whether a
    // given push happened before or after that user was actually eliminated.
    const eliminatedAtIndex = new Map<Uuid, number>();
    for (let i = 0; i < log.length; i++) {
      const entry = log[i]!;
      if (entry.kind === "personal" && entry.message.type === "player.status" && entry.message.status === "eliminated") {
        if (!eliminatedAtIndex.has(entry.userId)) eliminatedAtIndex.set(entry.userId, i);
      }
    }

    // Right after every round.lock broadcast, exactly this round's actual answerers (0, 1, or 2 —
    // fewer once one of them has since been eliminated) get a player.pending push
    // (pushPendingForAnswerers runs synchronously, immediately after the round.lock broadcast,
    // before any other event is processed). The push includes the just-locked round *unless* that
    // answerer had already been eliminated by an earlier round's settle overlapping this one's lock
    // (round overlap: they can answer round N+1 before round N settles and eliminates them) — an
    // eliminated player holds nothing pending, even a round they legitimately answered.
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

    // By the end of the fixture every round has settled — each answerer's last player.pending
    // push reports nothing left pending.
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

    // Publish just enough of the fixture to get the first round open, then stop — we only need
    // an open round to submit against, not a full replay.
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

    // One of the two answering players is eliminated by this fixture (whichever's guess stops
    // matching the actual outcome first) — find whoever it is, generically.
    const eliminatedIndex = personal.findIndex(
      (e) =>
        (e.userId === PLAYER_ANSWERS_YES || e.userId === PLAYER_ANSWERS_NO) &&
        e.message.type === "player.status" &&
        e.message.status === "eliminated",
    );
    expect(eliminatedIndex).toBeGreaterThanOrEqual(0);
    const eliminatedUserId = personal[eliminatedIndex]!.userId;

    // The very next personal message to that same user clears their pending list — they must not
    // be left showing an in-flight round (answered before elimination, still awaiting settle) as
    // if they were still participating in it.
    const next = personal[eliminatedIndex + 1];
    expect(next?.userId).toBe(eliminatedUserId);
    expect(next?.message).toEqual({ type: "player.pending", predictions: [] });

    // Holds for the rest of the arena too, not just at the moment of elimination.
    expect(runtime.pendingPredictionsFor(eliminatedUserId)).toEqual([]);

    // Regression: a player who never gets eliminated in this run isn't affected by this — they
    // still get normal (non-empty, then eventually empty-at-settle) pending pushes as before.
    const survivorId = eliminatedUserId === PLAYER_ANSWERS_YES ? PLAYER_ANSWERS_NO : PLAYER_ANSWERS_YES;
    const survivorPending = personal.filter((e) => e.userId === survivorId && e.message.type === "player.pending");
    expect(survivorPending.some((e) => e.message.type === "player.pending" && e.message.predictions.length > 0)).toBe(
      true,
    );
  });
});
