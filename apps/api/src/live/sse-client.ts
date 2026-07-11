// Ported from world-cup's services/match-event-stream.service.ts, rewired onto this
// project's own ScoreSnapshotSchema (../ingestion/score-snapshot.js) instead of the draft's.

import type { Readable } from "node:stream";
import { txoddsClient } from "./config/txodds-client.js";
import { logger } from "./logger.js";
import { ScoreSnapshotSchema, type ScoreSnapshot } from "../ingestion/score-snapshot.js";

function assertFixtureId(fixtureId: number): void {
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    throw new Error(`Invalid fixtureId: ${fixtureId}`);
  }
}

/** One parsed frame off the `/scores/stream` SSE feed. */
export type StreamMessage =
  | { kind: "event"; id: string | undefined; event: ScoreSnapshot }
  | { kind: "heartbeat"; id: string | undefined };

/** One raw SSE frame (field lines joined between blank-line boundaries), before JSON parsing. */
interface RawFrame {
  id: string | undefined;
  event: string;
  data: string | undefined;
}

/**
 * Opens a real-time, long-lived connection to `/scores/stream` for `fixtureId` and yields each
 * parsed frame as it arrives — no polling interval, the generator only resolves a step when
 * the server pushes a message or a heartbeat. `lastEventId` (the feed's `timestamp:index`
 * cursor) is sent as `Last-Event-ID` so a reconnect resumes without gaps or duplicates.
 *
 * A single malformed/unparseable frame is logged and skipped rather than killing the
 * connection; the caller (the stream worker) owns reconnection once the underlying HTTP
 * request itself ends or fails.
 */
export async function* streamEvents(
  fixtureId: number,
  lastEventId?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamMessage> {
  assertFixtureId(fixtureId);

  const res = await txoddsClient.get("/scores/stream", {
    responseType: "stream",
    timeout: 0, // long-lived connection — the client's default 15s timeout must not apply here
    params: { fixtureId },
    headers: lastEventId ? { "Last-Event-ID": lastEventId } : {},
    ...(signal ? { signal } : {}),
  });

  const body = res.data as Readable;
  let buffer = "";

  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");

    for (;;) {
      const boundary = findFrameBoundary(buffer);
      if (!boundary) break; // no complete frame buffered yet — wait for the next chunk

      const rawFrame = buffer.slice(0, boundary.start);
      buffer = buffer.slice(boundary.end);
      const frame = parseFrame(rawFrame);
      if (!frame) continue; // comment-only / empty frame

      const msg = toStreamMessage(fixtureId, frame);
      if (msg) yield msg;
    }
  }
}

/** Finds the next blank-line frame boundary (`\n\n` or `\r\n\r\n`) in `buffer`, or `undefined` if no complete frame is buffered yet. */
function findFrameBoundary(buffer: string): { start: number; end: number } | undefined {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { start: crlf, end: crlf + 4 };
  }
  return { start: lf, end: lf + 2 };
}

/** Parses one raw SSE frame's field lines into `{id, event, data}`. Returns undefined for a frame with no usable fields. */
function parseFrame(rawFrame: string): RawFrame | undefined {
  const lines = rawFrame.split(/\r\n|\n/);
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment line
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (id === undefined && dataLines.length === 0 && event === "message") return undefined;
  return { id, event, data: dataLines.length > 0 ? dataLines.join("\n") : undefined };
}

/** Converts a raw SSE frame into a `StreamMessage`, validating/parsing `data` for non-heartbeat frames. */
function toStreamMessage(fixtureId: number, frame: RawFrame): StreamMessage | undefined {
  if (frame.event === "heartbeat") {
    return { kind: "heartbeat", id: frame.id };
  }

  if (frame.data === undefined) return undefined;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(frame.data);
  } catch (err) {
    logger.error({ fixtureId, err, data: frame.data }, "stream frame is not valid JSON — skipped");
    return undefined;
  }

  const parsed = ScoreSnapshotSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.error({ fixtureId, issues: parsed.error.issues.slice(0, 5) }, "stream frame schema mismatch — skipped");
    return undefined;
  }

  return { kind: "event", id: frame.id, event: parsed.data };
}
