import { describe, expect, it, vi } from "vitest";
import type { GridCatalogSeries } from "../central-data-client.js";
import { activateCs2Series } from "../operator-activate.js";

const selected: GridCatalogSeries = {
  gridSeriesId: "series-1",
  format: 3,
  scheduledStartTime: new Date("2026-09-02T12:00:00.000Z"),
  competition: { gridTournamentId: "tournament-1", name: "Major" },
  participants: [
    { state: "known", displayOrder: 1, team: { gridTeamId: "team-a", name: "Team A" } },
    { state: "known", displayOrder: 2, team: { gridTeamId: "team-b", name: "Team B" } },
  ],
  hasFullLiveData: true,
};

describe("activateCs2Series", () => {
  it("looks up the exact Series, fetches only its tournament, then synchronizes the validated result", async () => {
    const fetchSeriesById = vi.fn().mockResolvedValue(selected);
    const fetchSeries = vi.fn().mockResolvedValue([selected]);
    const synchronize = vi.fn().mockImplementation(async (_window, options) => {
      expect(options.tournamentIds).toEqual(["tournament-1"]);
      await expect(options.source.fetchSeries()).resolves.toEqual([selected]);
      return { discovered: 1, persisted: 1, supported: 1, incompleteParticipants: 0 };
    });
    const now = new Date("2026-09-02T00:00:00.000Z");

    await expect(activateCs2Series("series-1", {
      now,
      client: { fetchSeriesById, fetchSeries },
      synchronize,
    })).resolves.toEqual({
      tournamentId: "tournament-1",
      seriesId: "series-1",
      scheduledStartTime: selected.scheduledStartTime,
      syncedSeries: 1,
    });
    expect(fetchSeriesById).toHaveBeenCalledWith("series-1");
    expect(fetchSeries).toHaveBeenCalledWith(
      { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-10-02T00:00:00.000Z") },
      ["tournament-1"],
    );
    expect(synchronize).toHaveBeenCalledOnce();
  });
});
