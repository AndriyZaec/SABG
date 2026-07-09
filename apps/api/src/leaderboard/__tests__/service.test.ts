import { describe, expect, it } from "vitest";
import type { LeaderboardEntry, Uuid } from "@arena/contracts";
import type { PlayerResultEvent, SettlementEvent } from "../../settlement/engine.js";
import { LeaderboardService, type LeaderboardRosterEntry } from "../service.js";

const ARENA_ID = "arena-1";

function roster(userIds: Uuid[]): LeaderboardRosterEntry[] {
  return userIds.map((userId, i) => ({
    userId,
    username: `user-${i}`,
    joinedAt: `2024-01-01T00:00:0${i}.000Z`,
  }));
}

function setup(userIds: Uuid[]) {
  const snapshots: LeaderboardEntry[][] = [];
  const finishedCalls: Uuid[][] = [];
  const service = new LeaderboardService(ARENA_ID, roster(userIds), {
    onSnapshot: (entries) => snapshots.push(entries),
    onFinished: (winners) => finishedCalls.push(winners),
  });
  return { service, snapshots, finishedCalls };
}

/** Drives one settled round: buffers each player's result, then fires onRoundSettled. */
function settleRound(
  service: LeaderboardService,
  roundId: Uuid,
  results: Array<Omit<PlayerResultEvent, "roundId">>,
  overrides: Partial<Omit<SettlementEvent, "roundId">> = {},
): void {
  for (const result of results) service.onPlayerResult({ roundId, ...result });
  service.onRoundSettled({
    type: "settle",
    roundId,
    windowStartMinute: 0,
    correctAnswer: "yes",
    settledBy: "window_end",
    ...overrides,
  });
}

describe("LeaderboardService", () => {
  it("one-survivor: eliminating everyone but one finishes the arena early with that sole winner", () => {
    const { service, finishedCalls } = setup(["a", "b", "c"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: "no", result: "incorrect", status: "eliminated" },
      { userId: "c", answer: undefined, result: "missed", status: "eliminated" },
    ]);

    expect(finishedCalls).toEqual([["a"]]);
    const entry = service.snapshot().find((e) => e.userId === "a");
    expect(entry?.status).toBe("winner");
    expect(service.snapshot().find((e) => e.userId === "b")?.status).toBe("eliminated");
  });

  it("multi-survivor at full time: finalize() makes every remaining active player a winner", () => {
    const { service, finishedCalls } = setup(["a", "b", "c"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: "yes", result: "correct", status: "active" },
      { userId: "c", answer: "no", result: "incorrect", status: "eliminated" },
    ]);

    service.finalize();

    expect(finishedCalls).toEqual([["a", "b"]]);
    expect(service.snapshot().find((e) => e.userId === "a")?.status).toBe("winner");
    expect(service.snapshot().find((e) => e.userId === "b")?.status).toBe("winner");
  });

  it("full tie -> shared: equal scores at finalize still make everyone a winner (no tie-break selection)", () => {
    const { service, finishedCalls } = setup(["a", "b"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: "yes", result: "correct", status: "active" },
    ]);
    settleRound(service, "r2", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: "yes", result: "correct", status: "active" },
    ]);

    service.finalize();

    expect(finishedCalls).toEqual([["a", "b"]]);
    expect(service.snapshot().find((e) => e.userId === "a")?.score).toBe(2);
    expect(service.snapshot().find((e) => e.userId === "b")?.score).toBe(2);
  });

  it("zero-survivors: a round eliminating every remaining active player makes all pre-round finalists winners", () => {
    const { service, finishedCalls } = setup(["a", "b"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "no", result: "incorrect", status: "eliminated" },
      { userId: "b", answer: "no", result: "incorrect", status: "eliminated" },
    ]);

    expect(finishedCalls).toEqual([["a", "b"]]);
    expect(service.snapshot().find((e) => e.userId === "a")?.status).toBe("winner");
    expect(service.snapshot().find((e) => e.userId === "b")?.status).toBe("winner");
  });

  it("accumulates score on correct and missedCount on missed across rounds", () => {
    // Three players (not two) so eliminating "b" doesn't leave "a" as the sole survivor and
    // trigger an early finish — this test is only about score/missedCount accumulation.
    const { service } = setup(["a", "b", "c"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: undefined, result: "missed", status: "eliminated" },
      { userId: "c", answer: "yes", result: "correct", status: "active" },
    ]);

    const a = service.snapshot().find((e) => e.userId === "a");
    const b = service.snapshot().find((e) => e.userId === "b");
    expect(a).toMatchObject({ score: 1, missedCount: 0, status: "active" });
    expect(b).toMatchObject({ score: 0, missedCount: 1, status: "eliminated" });
    expect(a?.avgAnswerMs).toBeUndefined();
  });

  it("assigns rank on every snapshot and is idempotent once finished (no further onFinished/status changes)", () => {
    const { service, finishedCalls, snapshots } = setup(["a", "b"]);

    settleRound(service, "r1", [
      { userId: "a", answer: "no", result: "incorrect", status: "eliminated" },
      { userId: "b", answer: "no", result: "incorrect", status: "eliminated" },
    ]);
    expect(finishedCalls).toHaveLength(1);
    const snapshotCountAfterFinish = snapshots.length;

    // Further calls after the arena already finished must be no-ops.
    service.finalize();
    settleRound(service, "r2", [
      { userId: "a", answer: "yes", result: "correct", status: "active" },
      { userId: "b", answer: "yes", result: "correct", status: "active" },
    ]);

    expect(finishedCalls).toHaveLength(1);
    expect(snapshots).toHaveLength(snapshotCountAfterFinish);
    expect(service.snapshot().find((e) => e.userId === "a")?.status).toBe("winner");
    expect(service.snapshot().every((e) => e.rank !== undefined)).toBe(true);
  });
});
