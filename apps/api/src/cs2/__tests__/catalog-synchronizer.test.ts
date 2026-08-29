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
        participants: [
          { state: "known", displayOrder: 1, team: { gridTeamId: "team-a", name: "A" } },
          { state: "tbd", displayOrder: 2 },
        ],
        hasFullLiveData: true,
      },
      {
        gridSeriesId: "past",
        format: 1,
        scheduledStartTime: new Date("2026-09-01T06:00:00.000Z"),
        competition,
        participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }],
        hasFullLiveData: false,
      },
    ]);
    const synchronizeSeries = vi.fn().mockResolvedValue({ seriesId: "id", participantCount: 0 });

    const result = await synchronizeCs2Catalog(window, {
      now: new Date("2026-09-01T12:00:00.000Z"),
      tournamentIds: ["tournament-1"],
      source: { fetchSeries } as Cs2CatalogSource,
      store: { synchronizeSeries } as Cs2CatalogStore,
    });

    expect(synchronizeSeries.mock.calls[0]?.[0]).toMatchObject({
      gridSeriesId: "future",
      lifecycle: "upcoming",
      isSupported: true,
      participants: [
        { state: "known", displayOrder: 1, team: { gridTeamId: "team-a", name: "A" } },
        { state: "tbd", displayOrder: 2 },
      ],
    });
    expect(synchronizeSeries.mock.calls[1]?.[0]).toMatchObject({
      gridSeriesId: "past",
      lifecycle: "unknown",
      isSupported: false,
      participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }],
    });
    expect(result).toEqual({ discovered: 2, persisted: 2, supported: 1, incompleteParticipants: 2 });
  });

  it("deduplicates a series repeated across provider pages", async () => {
    const item = {
      gridSeriesId: "series-1",
      format: 3,
      scheduledStartTime: new Date("2026-09-02"),
      competition,
      participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }],
      hasFullLiveData: true,
    };
    const synchronizeSeries = vi.fn().mockResolvedValue({ seriesId: "id", participantCount: 0 });

    const result = await synchronizeCs2Catalog(window, {
      tournamentIds: ["tournament-1"],
      source: { fetchSeries: vi.fn().mockResolvedValue([item, item]) },
      store: { synchronizeSeries } as Cs2CatalogStore,
    });

    expect(synchronizeSeries).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(1);
  });

  it("rejects provider rows outside the selected tournaments", async () => {
    const synchronizeSeries = vi.fn();
    const fetchSeries = vi.fn().mockResolvedValue([
      {
        gridSeriesId: "other-series",
        format: 3,
        scheduledStartTime: new Date("2026-09-02"),
        competition: { gridTournamentId: "tournament-2", name: "Other" },
        participants: [{ state: "tbd", displayOrder: 1 }, { state: "tbd", displayOrder: 2 }],
        hasFullLiveData: true,
      },
    ]);

    await expect(synchronizeCs2Catalog(window, {
      tournamentIds: ["tournament-1"],
      source: { fetchSeries } as Cs2CatalogSource,
      store: { synchronizeSeries } as Cs2CatalogStore,
    })).resolves.toEqual({ discovered: 0, persisted: 0, supported: 0, incompleteParticipants: 0 });
    expect(fetchSeries).toHaveBeenCalledWith(window, ["tournament-1"], undefined);
    expect(synchronizeSeries).not.toHaveBeenCalled();
  });
});
