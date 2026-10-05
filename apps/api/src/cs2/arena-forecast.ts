// Which series the autopilot will give an arena: its own launch rule played forward with expected durations.
// Only a forecast — a series that runs long or ends early changes it.

import type { Cs2SeriesArenaForecast, IsoDateTime, Uuid } from "@arena/contracts";
import { compareLaunchOrder, isLaunchCandidate, LATE_START_WINDOW_MS, type Cs2SeriesCandidate } from "./next-series.js";

const MIN = 60_000;

/** Expected length of a series: Bo1 90 min, Bo3 240 min, Bo5 360 min, otherwise 90 min per map. */
export function expectedSeriesDurationMs(format: number): number {
  if (format === 3) return 240 * MIN;
  if (format === 5) return 360 * MIN;
  return 90 * MIN * format;
}

/** `runningSeriesId`: the series the autopilot runs, which holds the slot even before its first arena opens. */
export function forecastArenas(
  candidates: readonly Cs2SeriesCandidate[],
  now: IsoDateTime,
  options: { autopilotEnabled: boolean; runningSeriesId?: Uuid } = { autopilotEnabled: true },
): Map<Uuid, Cs2SeriesArenaForecast> {
  const nowMs = Date.parse(now);
  const forecast = new Map<Uuid, Cs2SeriesArenaForecast>();

  // A running series holds the single slot until its expected end, or now if it runs long.
  let freeAt = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    if (c.status !== "active" || !(c.hasArena || c.seriesId === options.runningSeriesId)) continue;
    forecast.set(c.seriesId, "running");
    freeAt = Math.max(freeAt, Date.parse(c.scheduledStartTime) + expectedSeriesDurationMs(c.format), nowMs);
  }

  // The launcher's order; a stable id tie-break instead of its random one, so the forecast doesn't flicker.
  const queue = candidates
    .filter((c) => !forecast.has(c.seriesId) && isLaunchCandidate(c, nowMs))
    .sort((a, b) => compareLaunchOrder(a, b) || a.seriesId.localeCompare(b.seriesId));
  for (const c of queue) {
    const start = Date.parse(c.scheduledStartTime);
    // The launcher still takes a series whose start passed up to 30 min before the slot frees.
    // Switched off, it launches nothing new until the operator turns it back on.
    if (options.autopilotEnabled && start + LATE_START_WINDOW_MS >= freeAt) {
      forecast.set(c.seriesId, "expected");
      freeAt = Math.max(start, freeAt) + expectedSeriesDurationMs(c.format);
    } else {
      forecast.set(c.seriesId, "unlikely");
    }
  }

  for (const c of candidates) {
    if (forecast.has(c.seriesId)) continue;
    if (c.hasArena) {
      forecast.set(c.seriesId, "ended");
      continue;
    }
    // Not selectable yet (a TBD team): whether it can launch at all isn't known, so no forecast. Anything else is final.
    const open =
      c.status === "active" && !c.hasArena && !c.skipRequested && Date.parse(c.scheduledStartTime) >= nowMs - LATE_START_WINDOW_MS;
    forecast.set(c.seriesId, open ? "unknown" : "none");
  }
  return forecast;
}
