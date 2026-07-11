// Test: "a real client passes a full round over WS; contract = the mock." No WS
// server or database is involved — the runtime is source-agnostic (driven by a MatchSignalBus)
// and its persistence/broadcast ports are both injectable, so this drives the *real* engine
// pipeline (unchanged) over the same recorded fixture the other engine tests use, via a
// broadcaster spy standing in for a real WS client, and in-memory stores standing in for Postgres.

import { describe, expect, it } from "vitest";
import type { Answer, ArenaPlayerStatus, ServerMessage, Uuid } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { replayFixture, FIXTURE_MATCH_ID } from "../../ingestion/replay.js";
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

  it("never reveals an individual player's answer via personal player.status — only status/roundId", () => {
    const { bus, personal } = buildRuntime();
    replayFixture(bus, FIXTURE_MATCH_ID);

    for (const { message } of personal) {
      expect(message.type).toBe("player.status");
      if (message.type === "player.status") {
        const validStatuses: ArenaPlayerStatus[] = ["active", "eliminated", "winner"];
        expect(validStatuses).toContain(message.status);
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
});
