import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

vi.mock("../../grid/mongo/mongo.service.js", () => ({
  MongoService: { getDb: vi.fn() },
}));

import { MongoService } from "../../grid/mongo/mongo.service.js";
import { Cs2RawRecorder, CS2_RAW_POLLS_COLLECTION } from "../raw-recorder.js";

function rawBody(games: unknown[] | undefined, errors?: unknown[]) {
  return {
    data: games !== undefined ? { seriesState: { games } } : { seriesState: {} },
    ...(errors !== undefined && { errors }),
  };
}

function liveMap(sequenceNumber: number | undefined, scores: [number, number]) {
  return rawBody([
    {
      ...(sequenceNumber !== undefined && { sequenceNumber }),
      teams: [{ name: "A", score: scores[0] }, { name: "B", score: scores[1] }],
    },
  ]);
}

const FRESH_LIVE = liveMap(1, [0, 0]);
const CONTINUING_LIVE = liveMap(1, [5, 3]);
const MAP_ENDED = rawBody([]);
const NO_GAMES = rawBody(undefined);
const NULL_SERIES_STATE = { data: { seriesState: null } };

function fakeDb(insertOne: Mock) {
  return { collection: vi.fn().mockReturnValue({ insertOne }) };
}

function writtenDocs(insertOne: Mock) {
  return insertOne.mock.calls.map((call) => call[0]);
}

describe("Cs2RawRecorder", () => {
  let insertOne: Mock;

  beforeEach(() => {
    insertOne = vi.fn().mockResolvedValue({ insertedId: "x" });
    (MongoService.getDb as Mock).mockReset().mockResolvedValue(fakeDb(insertOne));
  });

  it("writes a map picked up mid-way, not only from 0-0", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: CONTINUING_LIVE, status: 200 });

    expect(writtenDocs(insertOne)).toEqual([
      expect.objectContaining({
        seriesId: "2991032",
        sessionKey: "cs2_series_2991032_map_1",
        mapSequenceNumber: 1,
        httpStatus: 200,
        payload: CONTINUING_LIVE,
      }),
    ]);
    expect(writtenDocs(insertOne)[0]).not.toHaveProperty("mapEnded");
  });

  it("keys the session by series and map, so a new recorder on the same map continues it", async () => {
    const first = new Cs2RawRecorder("2991032");
    await first.handlePoll({ data: FRESH_LIVE });
    const restarted = new Cs2RawRecorder("2991032");
    await restarted.handlePoll({ data: CONTINUING_LIVE });

    expect(writtenDocs(insertOne).map((doc) => doc.sessionKey)).toEqual([
      "cs2_series_2991032_map_1",
      "cs2_series_2991032_map_1",
    ]);
  });

  it("writes the map-end frame once with mapEnded, skips later empty frames, and keys the next map on its own", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: CONTINUING_LIVE });
    await recorder.handlePoll({ data: MAP_ENDED });
    await recorder.handlePoll({ data: MAP_ENDED });
    await recorder.handlePoll({ data: liveMap(2, [0, 0]) });

    const docs = writtenDocs(insertOne);
    expect(docs.map((doc) => [doc.sessionKey, doc.mapEnded])).toEqual([
      ["cs2_series_2991032_map_1", undefined],
      ["cs2_series_2991032_map_1", true],
      ["cs2_series_2991032_map_2", undefined],
    ]);
    expect(docs[1]).toMatchObject({ mapSequenceNumber: 1, payload: MAP_ENDED });
  });

  it("does not write an empty game list without an open session", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: MAP_ENDED });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("does not write a live game without sequenceNumber", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: liveMap(undefined, [5, 3]) });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it.each([
    ["without games", NO_GAMES],
    ["with a null seriesState", NULL_SERIES_STATE],
  ])("treats a frame %s as a bad frame, not a map end", async (_label, badFrame) => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: FRESH_LIVE });
    await recorder.handlePoll({ data: badFrame });
    await recorder.handlePoll({ data: CONTINUING_LIVE });
    await recorder.handlePoll({ data: MAP_ENDED });

    const docs = writtenDocs(insertOne);
    expect(docs.map((doc) => [doc.sessionKey, doc.mapEnded])).toEqual([
      ["cs2_series_2991032_map_1", undefined],
      ["cs2_series_2991032_map_1", undefined],
      ["cs2_series_2991032_map_1", true],
    ]);
    expect(docs.map((doc) => doc.payload)).not.toContainEqual(badFrame);
  });

  it("skips frames that fail the response schema", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: { data: { seriesState: { games: "not-a-list" } } } });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("skips frames carrying GraphQL-level errors", async () => {
    const recorder = new Cs2RawRecorder("2991032");
    await recorder.handlePoll({ data: rawBody([{ sequenceNumber: 1, teams: [] }], [{ message: "boom" }]) });
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

    await recorder.handlePoll({ data: FRESH_LIVE });
    for (let i = 0; i < 4; i++) await recorder.handlePoll({ data: CONTINUING_LIVE });

    expect(insertOne).toHaveBeenCalledTimes(5);

    await recorder.handlePoll({ data: CONTINUING_LIVE });
    expect(insertOne).toHaveBeenCalledTimes(5);
  });
});
