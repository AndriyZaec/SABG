import { describe, expect, it, vi } from "vitest";
import type { GridGraphqlRequester } from "../../grid/graphql-client.js";
import { GridCentralDataClient } from "../central-data-client.js";

function response(data: unknown) {
  return { status: 200, headers: {}, data };
}

function seriesNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "series-1",
    format: { name: "Best of 3", nameShortened: "Bo3" },
    private: false,
    productServiceLevels: [{ productName: "Live Data Feed", serviceLevel: "FULL" }],
    startTimeScheduled: "2026-09-01T12:00:00.000Z",
    teams: [
      { baseInfo: { id: "team-a", logoUrl: "https://img/a", name: "Team A", nameShortened: "A" } },
      { baseInfo: { id: "team-b", logoUrl: "https://img/b", name: "Team B", nameShortened: "B" } },
    ],
    tournament: {
      id: "tournament-1",
      logoUrl: "https://img/tournament",
      name: "Major",
      nameShortened: "MJR",
    },
    ...overrides,
  };
}

describe("GridCentralDataClient", () => {
  it("resolves CS2 by title metadata and follows allSeries cursors", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ data: { titles: [
        { id: "title-lol", name: "League of Legends", nameShortened: "LoL" },
        { id: "title-cs2", name: "Counter-Strike 2", nameShortened: "CS2" },
      ] } }))
      .mockResolvedValueOnce(response({ data: { allSeries: {
        edges: [{ node: seriesNode() }],
        pageInfo: { endCursor: "cursor-1", hasNextPage: true },
      } } }))
      .mockResolvedValueOnce(response({ data: { allSeries: {
        edges: [{ node: seriesNode({ id: "series-2", teams: [] }) }],
        pageInfo: { endCursor: "cursor-2", hasNextPage: false },
      } } }));
    const client = new GridCentralDataClient({ request } as GridGraphqlRequester);

    const series = await client.fetchSeries(
      {
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-02T00:00:00.000Z"),
      },
      ["tournament-1"],
    );

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      gridSeriesId: "series-1",
      format: 3,
      hasFullLiveData: true,
      competition: { gridTournamentId: "tournament-1", name: "Major" },
      teams: [{ gridTeamId: "team-a", name: "Team A" }, { gridTeamId: "team-b", name: "Team B" }],
    });
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      first: 50,
      filter: { titleId: "title-cs2", tournamentIds: { in: ["tournament-1"] } },
    });
    expect(request.mock.calls[2]?.[1]).toMatchObject({ after: "cursor-1", filter: { titleId: "title-cs2" } });
  });

  it("rejects GraphQL errors instead of treating them as an empty catalog", async () => {
    const request = vi.fn().mockResolvedValue(response({ errors: [{ message: "forbidden" }] }));
    const client = new GridCentralDataClient({ request } as GridGraphqlRequester);

    await expect(client.resolveCs2TitleId()).rejects.toThrow("forbidden");
  });

  it("skips private and malformed participant sets", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ data: { titles: [
        { id: "title-cs2", name: "Counter-Strike 2", nameShortened: "CS2" },
      ] } }))
      .mockResolvedValueOnce(response({ data: { allSeries: {
        edges: [
          { node: seriesNode({ private: true }) },
          { node: seriesNode({ id: "series-2", teams: [
            { baseInfo: { id: "a", logoUrl: "", name: "A", nameShortened: "A" } },
            { baseInfo: { id: "b", logoUrl: "", name: "B", nameShortened: "B" } },
            { baseInfo: { id: "c", logoUrl: "", name: "C", nameShortened: "C" } },
          ] }) },
        ],
        pageInfo: { endCursor: null, hasNextPage: false },
      } } }));
    const client = new GridCentralDataClient({ request } as GridGraphqlRequester);

    await expect(
      client.fetchSeries({ from: new Date("2026-09-01"), to: new Date("2026-09-02") }, ["tournament-1"]),
    ).resolves.toEqual([]);
  });

  it("fails closed without selected tournaments", async () => {
    const request = vi.fn();
    const client = new GridCentralDataClient({ request } as GridGraphqlRequester);

    await expect(client.fetchSeries({ from: new Date("2026-09-01"), to: new Date("2026-09-02") }, [])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
