// Replays a recorded GRID series-state fixture through parseSnapshot + trackCs2Poll. CS2's
// analog of ingestion/replay.ts — used by tests and any one-off eyeballing script, not by
// production code (a later step wires a live GameSource directly to parseSnapshot/trackCs2Poll
// instead of this file).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Cs2MatchSignal, IsoDateTime } from "@arena/contracts";
import { parseSnapshot } from "./snapshot.js";
import { initialCs2TrackerState, trackCs2Poll, type Cs2TrackerState } from "./round-tracker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Cs2FixtureEntry {
  receivedAt: IsoDateTime;
  /** Raw GRID response envelope, exactly `GridClient.fetchSeriesState().data`'s shape. */
  raw: unknown;
}

export function loadCs2Fixture(fixturePath: string): Cs2FixtureEntry[] {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`fixture at ${fixturePath} is not an array`);
  return raw as Cs2FixtureEntry[];
}

export function defaultCs2FixturePath(): string {
  return path.join(__dirname, "__fixtures__", "cs2-series-28-map1.json");
}

/** Feeds every recorded poll through parseSnapshot + trackCs2Poll in order, returning every
 *  signal emitted and the tracker's final state. */
export function replayCs2Fixture(
  entries: Cs2FixtureEntry[],
): { signals: Cs2MatchSignal[]; finalState: Cs2TrackerState } {
  let state = initialCs2TrackerState();
  const signals: Cs2MatchSignal[] = [];

  for (const entry of entries) {
    const snapshot = parseSnapshot(entry.raw);
    const result = trackCs2Poll(state, snapshot, entry.receivedAt);
    state = result.state;
    signals.push(...result.signals);
  }

  return { signals, finalState: state };
}
