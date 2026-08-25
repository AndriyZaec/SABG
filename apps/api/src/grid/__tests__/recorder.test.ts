import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSeriesState: vi.fn(),
  write: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../grid-client.js", () => ({
  GridClient: class {
    fetchSeriesState = mocks.fetchSeriesState;
  },
}));

let capturedSessions: string[] = [];
vi.mock("../recording-session.js", () => ({
  RecordingSession: class {
    collectionName: string;
    writtenCount = 0;
    constructor(seriesId: string) {
      this.collectionName = `cs2_series_${seriesId}_${capturedSessions.length}`;
      capturedSessions.push(this.collectionName);
    }
    write = async (meta: unknown) => {
      this.writtenCount += 1;
      await mocks.write(meta);
    };
  },
}));

vi.mock("../logger.js", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { logger };
});

vi.mock("../../shared/sleep.js", () => ({ sleep: mocks.sleep }));

import { GridRecorder } from "../recorder.js";

/** `null` marks the fixture's explicit empty-games boundary. */
function frame(roundScore: [number, number] | null) {
  return {
    status: 200,
    headers: {},
    data: {
      data: {
        seriesState: {
          teams: [{ score: 0 }, { score: 0 }],
          games: roundScore === null ? [] : [{ teams: [{ score: roundScore[0] }, { score: roundScore[1] }] }],
        },
      },
    },
  };
}

describe("GridRecorder state machine", () => {
  beforeEach(() => {
    capturedSessions = [];
    mocks.fetchSeriesState.mockReset();
    mocks.write.mockClear();
    mocks.sleep.mockClear();
  });

  it("creates exactly two collections and writes live frames plus the closing transition frame across two back-to-back matches", async () => {
    const feed = [
      frame([0, 0]),
      frame([5, 3]),
      frame([8, 6]),
      frame(null),
      frame([0, 0]),
    ];
    let call = 0;
    mocks.fetchSeriesState.mockImplementation((signal?: AbortSignal) => {
      const next = feed[call];
      call += 1;
      if (next) return Promise.resolve(next);
      // Park after the fixture boundary until shutdown aborts the poll.
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    const recorder = new GridRecorder();
    recorder.start();

    await vi.waitFor(() => expect(call).toBeGreaterThanOrEqual(feed.length), { timeout: 1000 });
    await recorder.shutdown();

    expect(capturedSessions).toHaveLength(2);
    expect(mocks.write).toHaveBeenCalledTimes(5);
  });
});
