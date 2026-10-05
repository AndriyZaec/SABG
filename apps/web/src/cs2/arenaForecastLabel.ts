import type { Cs2SeriesArenaForecast } from "@arena/contracts";

// Soft wording for the forecasts: the schedule can still move. `unknown` shows nothing: teams aren't known yet.
export const arenaForecastLabel: Record<Cs2SeriesArenaForecast, string | undefined> = {
  running: "Arena live",
  expected: "Arena expected",
  unlikely: "Arena unlikely",
  unknown: undefined,
  ended: "Arena closed",
  none: "No arena",
};
