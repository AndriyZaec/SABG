import { describe, expect, it } from "vitest";
import type { GridCatalogSeries } from "../central-data-client.js";
import { buildDiscoveryWindow, buildOperatorDiscoveryPayload, selectOperatorSeries } from "../operator-discovery.js";

function series(overrides: Partial<GridCatalogSeries> = {}): GridCatalogSeries {
  return {
    gridSeriesId: "series-1",
    format: 3,
    scheduledStartTime: new Date("2026-09-02T12:00:00.000Z"),
    competition: { gridTournamentId: "tournament-1", name: "Major" },
    participants: [
      { state: "known", displayOrder: 1, team: { gridTeamId: "team-a", name: "Team A" } },
      { state: "known", displayOrder: 2, team: { gridTeamId: "team-b", name: "Team B" } },
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
        series({
          gridSeriesId: "series-tbd",
          participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }],
        }),
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
    expect(() => selectOperatorSeries([
      series({ participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }] }),
    ], "series-1")).toThrow("PARTICIPANTS_INCOMPLETE");
    expect(() => selectOperatorSeries([], "missing-series")).toThrow("was not found");
  });
});
