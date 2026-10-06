import type { Cs2SeriesLifecycle, IsoDateTime } from "@arena/contracts";

export function catalogLifecycleOnRead(
  stored: Cs2SeriesLifecycle,
  scheduledStartTime: IsoDateTime,
  now: IsoDateTime,
  running: boolean,
): Cs2SeriesLifecycle {
  // The runner holds it before its first arena opens, e.g. while it waits for map 2.
  if (running && stored !== "completed") return "live";
  // Only the sync writes "upcoming", and it pauses while a series runs: a passed start must not stay upcoming.
  if (stored === "upcoming" && Date.parse(scheduledStartTime) <= Date.parse(now)) return "unknown";
  return stored;
}
