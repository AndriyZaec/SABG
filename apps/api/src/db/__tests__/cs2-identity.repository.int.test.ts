import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("cs2IdentityRepository (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let seriesRepository: typeof import("../repositories/series.repository.js")["seriesRepository"];
  let cs2IdentityRepository: typeof import("../repositories/cs2-identity.repository.js")["cs2IdentityRepository"];

  const runId = randomUUID();
  const gridSeriesId = `identity-series-${runId}`;
  const firstGridTeamId = `identity-team-a-${runId}`;
  const secondGridTeamId = `identity-team-b-${runId}`;
  const unknownGridTeamId = `identity-team-c-${runId}`;
  let seriesId: string;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ seriesRepository } = await import("../repositories/series.repository.js"));
    ({ cs2IdentityRepository } = await import("../repositories/cs2-identity.repository.js"));

    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(),
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (seriesId) await db.delete(schema.series).where(inArray(schema.series.id, [seriesId]));
    await db
      .delete(schema.cs2Teams)
      .where(inArray(schema.cs2Teams.gridTeamId, [firstGridTeamId, secondGridTeamId, unknownGridTeamId]));
  });

  it("persists two identities and keeps their display order when GRID swaps its array", async () => {
    const first = await cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
      { gridTeamId: firstGridTeamId, name: "Team A", score: 0 },
      { gridTeamId: secondGridTeamId, name: "Team B", score: 0 },
    ]);

    const swapped = await cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
      { gridTeamId: secondGridTeamId, name: "Team B Renamed", score: 1 },
      { gridTeamId: firstGridTeamId, name: "Team A", score: 2 },
    ]);

    expect(swapped).toEqual([
      { teamId: first[0].teamId, gridTeamId: firstGridTeamId, name: "Team A", displayOrder: 1, seriesScore: 2 },
      { teamId: first[1].teamId, gridTeamId: secondGridTeamId, name: "Team B Renamed", displayOrder: 2, seriesScore: 1 },
    ]);
  });

  it("is idempotent under concurrent synchronization", async () => {
    const input = [
      { gridTeamId: firstGridTeamId, name: "Team A", score: 2 },
      { gridTeamId: secondGridTeamId, name: "Team B Renamed", score: 1 },
    ] as const;

    const [first, second] = await Promise.all([
      cs2IdentityRepository.synchronizeSeriesTeams(seriesId, input),
      cs2IdentityRepository.synchronizeSeriesTeams(seriesId, input),
    ]);

    expect(second).toEqual(first);
  });

  it("rejects a changed team identity without persisting a third team", async () => {
    await expect(
      cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
        { gridTeamId: firstGridTeamId, name: "Team A", score: 2 },
        { gridTeamId: unknownGridTeamId, name: "Team C", score: 1 },
      ]),
    ).rejects.toThrow(`CS2 series ${seriesId} team identities changed`);

    const rows = await db
      .select({ gridTeamId: schema.cs2Teams.gridTeamId })
      .from(schema.cs2Teams)
      .where(inArray(schema.cs2Teams.gridTeamId, [firstGridTeamId, secondGridTeamId, unknownGridTeamId]));
    expect(rows.map((row) => row.gridTeamId).sort()).toEqual([firstGridTeamId, secondGridTeamId].sort());
  });
});
