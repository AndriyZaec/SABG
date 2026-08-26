import { describe, expect, it, vi } from "vitest";
import { synchronizeCs2Catalog, type Cs2CatalogSource, type Cs2CatalogStore } from "../catalog-synchronizer.js";

const competition = { gridTournamentId: "tournament-1", name: "Major" };
const window = { from: new Date("2026-09-01"), to: new Date("2026-09-03") };

describe("synchronizeCs2Catalog", () => {
  it("persists support, schedule-derived lifecycle, and partial participants without starting a runtime", async () => {
    const fetchSeries = vi.fn().mockResolvedValue([
      {
        gridSeriesId: "future",
        format: 3,
        scheduledStartTime: new Date("2026-09-02T12:00:00.000Z"),
        competition,
        teams: [{ gridTeamId: "team-a", name: "A" }],
        hasFullLiveData: true,
      },
      {
        gridSeriesId: "past",
        format: 1,
        scheduledStartTime: new Date("2026-09-01T06:00:00.000Z"),
        competition,
        teams: [],
        hasFullLiveData: false,
      },
    ]);
    const synchronizeSeries = vi.fn().mockResolvedValue({ seriesId: "id", participantCount: 0 });

    const result = await synchronizeCs2Catalog(window, {
      now: new Date("2026-09-01T12:00:00.000Z"),
      source: { fetchSeries } as Cs2CatalogSource,
      store: { synchronizeSeries } as Cs2CatalogStore,
    });

    expect(synchronizeSeries.mock.calls[0]?.[0]).toMatchObject({
      gridSeriesId: "future",
      lifecycle: "upcoming",
      isSupported: true,
      teams: [{ gridTeamId: "team-a" }],
    });
    expect(synchronizeSeries.mock.calls[1]?.[0]).toMatchObject({
      gridSeriesId: "past",
      lifecycle: "unknown",
      isSupported: false,
      teams: [],
    });
    expect(result).toEqual({ discovered: 2, persisted: 2, supported: 1, incompleteParticipants: 2 });
  });

  it("deduplicates a series repeated across provider pages", async () => {
    const item = {
      gridSeriesId: "series-1",
      format: 3,
      scheduledStartTime: new Date("2026-09-02"),
      competition,
      teams: [],
      hasFullLiveData: true,
    };
    const synchronizeSeries = vi.fn().mockResolvedValue({ seriesId: "id", participantCount: 0 });

    const result = await synchronizeCs2Catalog(window, {
      source: { fetchSeries: vi.fn().mockResolvedValue([item, item]) },
      store: { synchronizeSeries } as Cs2CatalogStore,
    });

    expect(synchronizeSeries).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(1);
  });
});
