// The 0:0 rule (plans/cs2-autopilot/03): only the live feed knows the score, so the priming poll decides.

import type { Cs2SeriesSnapshot } from "./series-snapshot.js";

export type Cs2SeriesEntry =
  | { kind: "enter_map_1" }
  | { kind: "enter_after_map_1" }
  | { kind: "skip"; reason: "already_started" | "bo1_in_progress" | "finished" };

// Structural, so it takes the priming snapshot before team identities are mapped.
type EntrySnapshot = Pick<Cs2SeriesSnapshot, "format" | "finished" | "hasLiveGame"> & {
  teams: readonly [{ score: number }, { score: number }];
};

export function decideSeriesEntry(snapshot: EntrySnapshot): Cs2SeriesEntry {
  // GRID can end a series at 0:0 (abandoned upstream); an arena for it would only take entry fees.
  if (snapshot.finished) return { kind: "skip", reason: "finished" };
  if (snapshot.teams[0].score !== 0 || snapshot.teams[1].score !== 0) return { kind: "skip", reason: "already_started" };
  if (!snapshot.hasLiveGame) return { kind: "enter_map_1" };
  // An unknown format can't be told apart from a Bo1, which has no map 2 to enter.
  if (snapshot.format === undefined || snapshot.format === 1) return { kind: "skip", reason: "bo1_in_progress" };
  return { kind: "enter_after_map_1" };
}
