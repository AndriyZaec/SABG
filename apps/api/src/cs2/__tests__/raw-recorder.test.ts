// Tests Cs2RawRecorder's WAITING_FOR_START/RECORDING state machine against a mocked
// MongoService.getDb() — no real Mongo involved. Mirrors the state-machine coverage grid/recorder
// would need, but scoped to this module's own best-effort/self-disable behavior.

import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("../../grid/mongo/mongo.service.js", () => ({
  MongoService: { getDb: vi.fn() },
}));

import { MongoService } from "../../grid/mongo/mongo.service.js";
import { Cs2RawRecorder, CS2_RAW_POLLS_COLLECTION } from "../raw-recorder.js";

/** Builds the full GraphQL response body (what GridClient.fetchSeriesState's `.data` field is). */
function rawBody(games: unknown[] | undefined, errors?: unknown[]) {
  return {
    data: games !== undefined ? { seriesState: { games } } : { seriesState: {} },
    ...(errors !== undefined && { errors }),
  };
}

const FRESH_LIVE = rawBody([{ teams: [{ name: "A", score: 0 }, { name: "B", score: 0 }] }]);
const CONTINUING_LIVE = rawBody([{ teams: [{ name: "A", score: 5 }, { name: "B", score: 3 }] }]);
const MAP_ENDED = rawBody([]);

function fakeDb(insertOne: Mock) {
  return { collection: vi.fn().mockReturnValue({ insertOne }) };
}

describe("Cs2RawRecorder", () => {
  let insertOne: Mock;

  beforeEach(() => {
    insertOne = vi.fn().mockResolvedValue({ insertedId: "x" });
    (MongoService.getDb as Mock).mockReset().mockResolvedValue(fakeDb(insertOne));
  });

  it("does not write before a fresh 0-0 start", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: CONTINUING_LIVE });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("starts a session on 0-0 and writes immediately when that frame already has a live game", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: FRESH_LIVE, status: 200 });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const doc = insertOne.mock.calls[0]![0];
    expect(doc).toMatchObject({ seriesId: "2991032", httpStatus: 200 });
    expect(typeof doc.sessionKey).toBe("string");
  });

  it("keeps writing on the same sessionKey while the map continues", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: FRESH_LIVE });
    await recorder.handlePoll({ data: CONTINUING_LIVE });

    expect(insertOne).toHaveBeenCalledTimes(2);
    const [firstDoc, secondDoc] = insertOne.mock.calls.map((c) => c[0]);
    expect(secondDoc.sessionKey).toBe(firstDoc.sessionKey);
  });

  it("writes the transition frame (games == []) before closing the session, then mints a new key on the next 0-0", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-12T10:00:00.000Z"));
      const recorder = new Cs2RawRecorder("2991032");
      await recorder.handlePoll({ data: FRESH_LIVE });
      await recorder.handlePoll({ data: MAP_ENDED });

      expect(insertOne).toHaveBeenCalledTimes(2);
      const firstSessionKey = insertOne.mock.calls[0]![0].sessionKey;
      expect(insertOne.mock.calls[1]![0].sessionKey).toBe(firstSessionKey);

      vi.setSystemTime(new Date("2026-08-12T10:05:00.000Z"));
      await recorder.handlePoll({ data: FRESH_LIVE });

      expect(insertOne).toHaveBeenCalledTimes(3);
      expect(insertOne.mock.calls[2]![0].sessionKey).not.toBe(firstSessionKey);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips frames carrying GraphQL-level errors", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: rawBody(undefined, [{ message: "boom" }]) });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("writes to the shared cs2_raw_polls collection", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: FRESH_LIVE });

    const db = await (MongoService.getDb as Mock).mock.results[0]!.value;
    expect(db.collection).toHaveBeenCalledWith(CS2_RAW_POLLS_COLLECTION);
  });

  it("never throws when the writer fails — best-effort", async () => {
    insertOne.mockRejectedValue(new Error("mongo down"));
    const recorder = new Cs2RawRecorder("2991032");
    await expect(recorder.handlePoll({ data: FRESH_LIVE })).resolves.toBeUndefined();
  });

  it("disables itself after repeated consecutive write failures", async () => {
    insertOne.mockRejectedValue(new Error("mongo down"));
    const recorder = new Cs2RawRecorder("2991032");

    await recorder.handlePoll({ data: FRESH_LIVE }); // 1: starts session + write attempt 1
    for (let i = 0; i < 4; i++) await recorder.handlePoll({ data: CONTINUING_LIVE }); // attempts 2-5

    expect(insertOne).toHaveBeenCalledTimes(5);

    await recorder.handlePoll({ data: CONTINUING_LIVE }); // would be attempt 6, but now disabled
    expect(insertOne).toHaveBeenCalledTimes(5);
  });
});
