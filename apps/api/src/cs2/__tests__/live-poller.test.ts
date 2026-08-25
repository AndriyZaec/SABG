import { describe, expect, it, vi } from "vitest";
import type { IsoDateTime, MatchSignal } from "@arena/contracts";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { initialCs2TrackerState } from "../round-tracker.js";
import { Cs2LivePoller, handleCs2LivePoll, type Cs2LivePollerTarget } from "../live-poller.js";
import type { Cs2SeriesSnapshot } from "../series-snapshot.js";

const NOW: IsoDateTime = "2026-08-11T12:00:00.000Z";

function rawWithGame(teams: unknown[], clock: unknown = { ticking: true, currentSeconds: 90 }) {
  return {
    data: {
      seriesState: {
        format: "best-of-3",
        finished: false,
        teams: [
          { name: "A", score: 0, won: false },
          { name: "B", score: 0, won: false },
        ],
        games: [{ clock, teams }],
      },
    },
  };
}

function liveTeams(a: number, b: number) {
  return [
    { name: "A", score: a, deaths: 0, weaponKills: [], players: [] },
    { name: "B", score: b, deaths: 0, weaponKills: [], players: [] },
  ];
}

class FakeTarget implements Cs2LivePollerTarget {
  readonly busA = new MatchSignalBus();
  readonly busB = new MatchSignalBus();
  private useB = false;
  readonly pollCalls: { snapshot: Cs2SeriesSnapshot | undefined; now: IsoDateTime }[] = [];
  readonly currentBusCallOrder: string[] = [];

  switchToArenaBAfterNextPoll = false;

  currentBus(): MatchSignalBus | undefined {
    this.currentBusCallOrder.push("currentBus");
    return this.useB ? this.busB : this.busA;
  }

  async poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    this.currentBusCallOrder.push("poll");
    this.pollCalls.push({ snapshot, now });
    if (this.switchToArenaBAfterNextPoll) this.useB = true;
  }
}

describe("handleCs2LivePoll — ordering", () => {
  it("reads currentBus() before calling target.poll() — publishes to the arena that was current before this poll's actions", async () => {
    const target = new FakeTarget();
    target.switchToArenaBAfterNextPoll = true;

    const receivedOnA: MatchSignal[] = [];
    const receivedOnB: MatchSignal[] = [];
    target.busA.subscribe((s) => receivedOnA.push(s));
    target.busB.subscribe((s) => receivedOnB.push(s));

    const raw = rawWithGame(liveTeams(0, 0));
    await handleCs2LivePoll(target, raw, initialCs2TrackerState(), NOW);

    expect(target.currentBusCallOrder).toEqual(["currentBus", "poll"]);
    expect(receivedOnA.some((s) => s.kind === "cs2_snapshot")).toBe(true);
    expect(receivedOnB).toEqual([]);
  });

  it("calls target.poll with the parsed series-level snapshot", async () => {
    const target = new FakeTarget();
    const raw = rawWithGame(liveTeams(1, 0));
    await handleCs2LivePoll(target, raw, initialCs2TrackerState(), NOW);

    expect(target.pollCalls).toHaveLength(1);
    expect(target.pollCalls[0]).toMatchObject({ now: NOW });
  });

  it("does not advance either lifecycle for a malformed/unrelated payload", async () => {
    const target = new FakeTarget();
    await handleCs2LivePoll(target, { unexpected: true }, initialCs2TrackerState(), NOW);
    expect(target.pollCalls).toEqual([]);
  });

  it("preserves a live map when a malformed payload arrives", async () => {
    const target = new FakeTarget();
    const received: MatchSignal[] = [];
    target.busA.subscribe((signal) => received.push(signal));

    const liveState = await handleCs2LivePoll(
      target,
      rawWithGame(liveTeams(3, 2)),
      initialCs2TrackerState(),
      NOW,
    );
    received.length = 0;

    const stateAfterMalformed = await handleCs2LivePoll(target, {
      data: {
        seriesState: {
          format: "best-of-3",
          finished: false,
          teams: [
            { name: "A", score: 0, won: false },
            { name: "B", score: 0, won: false },
          ],
          // Omitted games are malformed, not explicit evidence that the map ended.
        },
      },
    }, liveState, NOW);

    expect(stateAfterMalformed).toEqual(liveState);
    expect(received).toEqual([]);
    expect(target.pollCalls).toHaveLength(1);
  });

  it("preserves both lifecycles when only the map-level payload is valid", async () => {
    const target = new FakeTarget();
    const received: MatchSignal[] = [];
    target.busA.subscribe((signal) => received.push(signal));
    const liveState = await handleCs2LivePoll(
      target,
      rawWithGame(liveTeams(3, 2)),
      initialCs2TrackerState(),
      NOW,
    );
    received.length = 0;

    const stateAfterPartial = await handleCs2LivePoll(
      target,
      { data: { seriesState: { games: [{ clock: { ticking: true, currentSeconds: 40 }, teams: liveTeams(3, 2) }] } } },
      liveState,
      NOW,
    );

    expect(stateAfterPartial).toEqual(liveState);
    expect(received).toEqual([]);
    expect(target.pollCalls).toHaveLength(1);
  });

  it("publishes nothing when no arena is currently open (currentBus() returns undefined)", async () => {
    const target: Cs2LivePollerTarget = {
      currentBus: () => undefined,
      poll: vi.fn().mockResolvedValue(undefined),
    };
    const raw = rawWithGame(liveTeams(0, 0));
    await expect(handleCs2LivePoll(target, raw, initialCs2TrackerState(), NOW)).resolves.toBeDefined();
  });

  it("carries the tracker state forward across polls (round-lock detection needs the previous snapshot)", async () => {
    const target = new FakeTarget();
    const received: MatchSignal[] = [];
    target.busA.subscribe((s) => received.push(s));

    let state = initialCs2TrackerState();
    state = await handleCs2LivePoll(target, rawWithGame(liveTeams(0, 0), { ticking: true, currentSeconds: 3 }), state, NOW);
    state = await handleCs2LivePoll(target, rawWithGame(liveTeams(0, 0), { ticking: true, currentSeconds: 108 }), state, NOW);

    expect(received.some((s) => s.kind === "cs2_round_lock")).toBe(true);
  });
});

describe("Cs2LivePoller — error backoff", () => {
  it("keeps polling after a fetch failure instead of crashing the loop", async () => {
    vi.useFakeTimers();
    try {
      const target = new FakeTarget();
      let calls = 0;
      const fetchSeriesState = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) throw new Error("network blip");
        return { data: rawWithGame(liveTeams(0, 0)), status: 200 };
      });

      const poller = new Cs2LivePoller({ target, fetchSeriesState, pollIntervalMs: 10_000 });
      poller.start();

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(calls).toBeGreaterThanOrEqual(2);
      expect(target.pollCalls.length).toBeGreaterThanOrEqual(1);

      await poller.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shutdown() stops the loop and awaits the in-flight iteration", async () => {
    const target = new FakeTarget();
    const fetchSeriesState = vi.fn().mockResolvedValue({ data: rawWithGame(liveTeams(0, 0)), status: 200 });
    const poller = new Cs2LivePoller({ target, fetchSeriesState, pollIntervalMs: 100_000 });

    poller.start();
    await Promise.resolve();
    await poller.shutdown();

    const callsAtShutdown = (fetchSeriesState as ReturnType<typeof vi.fn>).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((fetchSeriesState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtShutdown);
  });
});
