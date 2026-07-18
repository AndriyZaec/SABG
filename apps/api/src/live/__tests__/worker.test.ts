import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { RateLimitState } from "../rate-limit.js";

const mocks = vi.hoisted(() => ({
  streamEvents: vi.fn(),
  findLatest: vi.fn(),
  insert: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../sse-client.js", () => ({ streamEvents: mocks.streamEvents }));
vi.mock("../mongo/stream-event.repository.js", () => ({
  StreamEventRepository: { findLatest: mocks.findLatest, insert: mocks.insert },
}));
vi.mock("../logger.js", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.logError,
    child: () => logger,
  };
  return { logger };
});

import { LiveIngestionWorker } from "../worker.js";

async function* oneEvent(seq: number | undefined) {
  yield {
    kind: "event" as const,
    id: `event-${seq ?? "missing"}`,
    event: { FixtureId: 100, Seq: seq, StatusId: 2, Clock: { Seconds: 60 } } as never,
  };
}

describe("LiveIngestionWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RateLimitState.retryAfterUntil = 0;
    mocks.findLatest.mockResolvedValue(undefined);
    mocks.insert.mockResolvedValue(1);
  });

  it("does not republish frames at or before the persisted sequence", async () => {
    mocks.findLatest.mockResolvedValue({ seq: 10, ts: new Date() });
    mocks.streamEvents.mockImplementation(() => oneEvent(10));
    const bus = new MatchSignalBus();
    const publish = vi.fn();
    bus.subscribe(publish);
    const worker = new LiveIngestionWorker("match-1", bus);

    await worker.start(100);
    worker.activate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.logError.mock.calls).toEqual([]);
    await vi.waitFor(() => expect(mocks.streamEvents).toHaveBeenCalled(), { timeout: 200 });
    worker.shutdown();
    await worker.waitUntilStopped();

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish a frame another worker already inserted", async () => {
    mocks.insert.mockResolvedValue(0);
    mocks.streamEvents.mockImplementation(() => oneEvent(11));
    const bus = new MatchSignalBus();
    const publish = vi.fn();
    bus.subscribe(publish);
    const worker = new LiveIngestionWorker("match-1", bus);

    await worker.start(100);
    worker.activate();
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce(), { timeout: 200 });
    worker.shutdown();
    await worker.waitUntilStopped();

    expect(publish).not.toHaveBeenCalled();
  });

  it("interrupts a rate-limit sleep during shutdown", async () => {
    RateLimitState.retryAfterUntil = Date.now() + 60_000;
    mocks.streamEvents.mockImplementation(() => oneEvent(12));
    const worker = new LiveIngestionWorker("match-1", new MatchSignalBus());

    await worker.start(100);
    const startedAt = Date.now();
    worker.shutdown();
    await worker.waitUntilStopped();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(mocks.streamEvents).not.toHaveBeenCalled();
  });

  it("does not start after shutdown wins a startup race", async () => {
    let releaseLatest!: () => void;
    mocks.findLatest.mockReturnValue(
      new Promise((resolve) => {
        releaseLatest = () => resolve(undefined);
      }),
    );
    const worker = new LiveIngestionWorker("match-1", new MatchSignalBus());

    const starting = worker.start(100);
    worker.shutdown();
    releaseLatest();
    await starting;
    await worker.waitUntilStopped();

    expect(worker.status().running).toBe(false);
    expect(mocks.streamEvents).not.toHaveBeenCalled();
  });

  it("does not persist or publish the readiness frame before activation", async () => {
    mocks.streamEvents.mockImplementation(() => oneEvent(13));
    const bus = new MatchSignalBus();
    const publish = vi.fn();
    bus.subscribe(publish);
    const worker = new LiveIngestionWorker("match-1", bus);

    await worker.start(100);
    await worker.waitUntilReady(200);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    worker.shutdown();
    await worker.waitUntilStopped();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("still publishes sequence-less frames that cannot be deduplicated", async () => {
    mocks.insert.mockResolvedValue(0);
    mocks.streamEvents.mockImplementation(() => oneEvent(undefined));
    const bus = new MatchSignalBus();
    const publish = vi.fn();
    bus.subscribe(publish);
    const worker = new LiveIngestionWorker("match-1", bus);

    await worker.start(100);
    worker.activate();
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    worker.shutdown();
    await worker.waitUntilStopped();

    expect(mocks.insert).toHaveBeenCalledOnce();
  });
});
