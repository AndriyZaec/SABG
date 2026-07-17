// Replays a recorded TXODDS fixture through the normalizer onto the bus (no live feed needed
// yet) and is the seed of the Replay Engine.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MatchSignal } from "@arena/contracts";
import { ScoreSnapshotSchema, type ScoreSnapshot } from "./score-snapshot.js";
import { createMatchSignalProducer } from "./match-signal.js";
import { MatchSignalBus } from "./event-bus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Placeholder match id for the recorded fixture (no real Match row exists for it yet). */
export const FIXTURE_MATCH_ID = "00000000-0000-0000-0000-000018179764";

export function loadFixture(fixturePath: string): ScoreSnapshot[] {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`fixture at ${fixturePath} is not an array`);
  return raw.map((entry) => ScoreSnapshotSchema.parse(entry));
}

export function defaultFixturePath(): string {
  return fixturePathFor(18179764);
}

/** Path to a recorded fixture by TXODDS fixture id — see `__fixtures__` for what's recorded. */
export function fixturePathFor(fixtureId: number): string {
  return path.join(__dirname, "__fixtures__", `fixture-${fixtureId}.json`);
}

/**
 * Feeds every raw message in `fixturePath` (already ordered by `Seq`/`Ts`) through a fresh
 * `MatchSignalProducer`, publishing every `MatchSignal` (settlement events + clock/possession)
 * onto `bus` in order. Returns the emitted signals for callers (tests, a replay CLI, the Match
 * State Engine) that want the full list.
 */
export function replayFixture(
  bus: MatchSignalBus,
  matchId: string = FIXTURE_MATCH_ID,
  fixturePath: string = defaultFixturePath(),
): MatchSignal[] {
  const raw = loadFixture(fixturePath);
  const producer = createMatchSignalProducer(matchId);
  const emitted: MatchSignal[] = [];

  for (const message of raw) {
    for (const signal of producer.process(message)) {
      bus.publish(signal);
      emitted.push(signal);
    }
  }

  return emitted;
}
