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

/** `roundScore` is the in-game round score of the (single) live game; `null` means no live game. */
function frame(roundScore: [number, number] | null) {
  return {
    status: 200,
    headers: {},
    data: {
      data: {
        seriesState: {
          teams: [{ score: 0 }, { score: 0 }], // series-level maps-won score; irrelevant here
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
      frame([0, 0]), // fresh 0-0 round score + live game -> session created and written in one frame
      frame([5, 3]), // still live -> write
      frame([8, 6]), // still live -> write
      frame(null), // games empty -> write final transition frame, then stop
      frame([0, 0]), // second match starts fresh -> new session, write
    ];
    let call = 0;
    mocks.fetchSeriesState.mockImplementation((signal?: AbortSignal) => {
      const next = feed[call];
      call += 1;
      if (next) return Promise.resolve(next);
      // Feed exhausted: park on an unresolved promise instead of polling further so the test
      // can assert on the exact 5-poll outcome; shutdown()'s abort settles it deterministically.
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
    // Writes: frame1, frame2, frame3, frame4-transition (first match) + frame5 (second match) = 5 writes.
    expect(mocks.write).toHaveBeenCalledTimes(5);
  });
});
