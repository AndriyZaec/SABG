import { describe, expect, it } from "vitest";
import type { GridCatalogSeries } from "../central-data-client.js";
import {
  buildDiscoveryWindow,
  buildOperatorDiscoveryPayload,
  selectOperatorSeries,
  selectOperatorTournament,
} from "../operator-discovery.js";

function series(overrides: Partial<GridCatalogSeries> = {}): GridCatalogSeries {
  return {
    gridSeriesId: "series-1",
    format: 3,
    scheduledStartTime: new Date("2026-09-02T12:00:00.000Z"),
    competition: { gridTournamentId: "tournament-1", name: "Major" },
    teams: [
      { gridTeamId: "team-a", name: "Team A" },
      { gridTeamId: "team-b", name: "Team B" },
    ],
    hasFullLiveData: true,
    ...overrides,
  };
}

describe("CS2 operator discovery", () => {
  it("builds the default bounded discovery window", () => {
    expect(buildDiscoveryWindow(new Date("2026-09-02T00:00:00.000Z"), 24, 30)).toEqual({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-10-02T00:00:00.000Z"),
    });
  });

  it("explains why an operator cannot select a Series", () => {
    const payload = buildOperatorDiscoveryPayload(
      { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-10-02T00:00:00.000Z") },
      [
        series(),
        series({ gridSeriesId: "series-tbd", teams: [] }),
        series({ gridSeriesId: "series-limited", hasFullLiveData: false }),
      ],
    );

    expect(payload.series.map((item) => item.selection)).toEqual([
      { state: "selectable" },
      { state: "disabled", reason: "PARTICIPANTS_INCOMPLETE" },
      { state: "disabled", reason: "FULL_LIVE_DATA_UNAVAILABLE" },
    ]);
    expect(payload.series.map((item) => item.liveDataServiceLevel)).toEqual(["FULL", "FULL", "UNAVAILABLE"]);
  });

  it("selects only a discovered Series with complete participants and FULL Live Data", () => {
    const selectable = series();

    expect(selectOperatorSeries([selectable], selectable.gridSeriesId)).toBe(selectable);
    expect(() => selectOperatorSeries([series({ teams: [] })], "series-1")).toThrow("PARTICIPANTS_INCOMPLETE");
    expect(() => selectOperatorSeries([], "missing-series")).toThrow("was not found");
  });

  it("selects every discovered Series in an operator-selected tournament", () => {
    const selected = series();
    const sibling = series({ gridSeriesId: "series-2" });
    const other = series({
      gridSeriesId: "series-3",
      competition: { gridTournamentId: "tournament-2", name: "Other" },
    });

    expect(selectOperatorTournament([selected, sibling, other], "tournament-1")).toEqual([selected, sibling]);
    expect(() => selectOperatorTournament([other], "tournament-1")).toThrow("was not found");
  });
});
