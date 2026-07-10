// B8 DoD test: "a full match from kickoff to winner in accelerated mode" — drives the headless
// replay demo (bots + ArenaRuntime + ReplayEngine) to completion with a spy broadcaster, no
// process/DB/WS involved, mirroring gateway/__tests__/arena-runtime.test.ts's pattern but with
// the scripted bot roster standing in for real WS clients.

import { describe, expect, it } from "vitest";
import type { ServerMessage, Uuid } from "@arena/contracts";
import type { GatewayBroadcaster } from "../../gateway/arena-runtime.js";
import { createReplayDemo } from "../run.js";

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

describe("replay demo — B8 DoD: full match from kickoff to a winner, accelerated", () => {
  it("plays the full fixture and reaches arena.finished with a genuine (not whole-roster) winner set", async () => {
    const { broadcaster, broadcasts } = createRecordingBroadcaster();
    const demo = createReplayDemo({ speed: 100_000, maxGapMs: 0, botCount: 6, broadcaster });

    await demo.play();

    expect(demo.runtime.matchState.period).toBe("full_time");

    const finishedMsg = broadcasts.find((m) => m.type === "arena.finished");
    expect(finishedMsg).toBeDefined();
    if (finishedMsg !== undefined && finishedMsg.type === "arena.finished") {
      expect(finishedMsg.winners.length).toBeGreaterThan(0);
      expect(demo.runtime.finalWinners()).toEqual(finishedMsg.winners);

      // Guards against the exact regression found while building this demo: bot-0 (always "yes")
      // and bot-1 (always "no") can never both be correct in the same round, so with real
      // elimination wired through (arena-runtime.ts's onPlayerResult -> leaderboardService),
      // at least one of them must NOT be among the final winners.
      expect(finishedMsg.winners).not.toEqual(expect.arrayContaining(demo.bots.map((b) => b.userId)));
    }

    // At least one round was actually opened and settled — the bots drove real predictions.
    expect(broadcasts.some((m) => m.type === "round.open")).toBe(true);
    expect(broadcasts.some((m) => m.type === "round.settle")).toBe(true);

    // Real per-round elimination reached the leaderboard (not just SettlementEngine's own
    // bookkeeping) — at least one leaderboard.update shows a non-active status before the finish.
    const eliminatedSeen = broadcasts.some(
      (m) => m.type === "leaderboard.update" && m.entries.some((e) => e.status === "eliminated"),
    );
    expect(eliminatedSeen).toBe(true);
  }, 20_000);

  it("defaults to a console broadcaster when none is supplied", async () => {
    const demo = createReplayDemo({ speed: 100_000, maxGapMs: 0, botCount: 4 });
    await demo.play();
    expect(demo.runtime.matchState.period).toBe("full_time");
  }, 20_000);
});
