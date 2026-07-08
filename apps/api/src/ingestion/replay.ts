// Replays a recorded TXODDS fixture through the normalizer onto the S3 bus. Satisfies B1's
// DoD (no live feed needed yet) and is the seed of the B8 Replay Engine.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { LiveEvent } from "@arena/contracts";
import { ScoreSnapshotSchema, type ScoreSnapshot } from "./score-snapshot.js";
import { createLiveEventProcessor } from "./incident-tracker.js";
import { LiveEventBus } from "./event-bus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Placeholder match id for the recorded fixture (no real Match row exists for it yet). */
export const FIXTURE_MATCH_ID = "00000000-0000-0000-0000-000018179764";

export function loadFixture(fixturePath: string): ScoreSnapshot[] {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`fixture at ${fixturePath} is not an array`);
  return raw.map((entry) => ScoreSnapshotSchema.parse(entry));
}

export function defaultFixturePath(): string {
  return path.join(__dirname, "__fixtures__", "fixture-18179764.json");
}

/**
 * Feeds every raw message in `fixturePath` (already ordered by `Seq`/`Ts`) through a fresh
 * `LiveEventProcessor`, publishing one confirmed, deduped `LiveEvent` per incident onto `bus`
 * in order. Returns the emitted events for callers (tests, a replay CLI) that want the full
 * list.
 */
export function replayFixture(
  bus: LiveEventBus,
  matchId: string = FIXTURE_MATCH_ID,
  fixturePath: string = defaultFixturePath(),
): LiveEvent[] {
  const raw = loadFixture(fixturePath);
  const processor = createLiveEventProcessor(matchId);
  const emitted: LiveEvent[] = [];

  for (const message of raw) {
    const event = processor.process(message);
    if (event === null) continue;
    bus.publish(event);
    emitted.push(event);
  }

  return emitted;
}
