import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("cs2CatalogRepository (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let repository: typeof import("../repositories/cs2-catalog.repository.js")["cs2CatalogRepository"];

  const runId = randomUUID();
  const gridSeriesId = `catalog-series-${runId}`;
  const gridTournamentId = `catalog-tournament-${runId}`;
  const firstGridTeamId = `catalog-team-a-${runId}`;
  const secondGridTeamId = `catalog-team-b-${runId}`;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ cs2CatalogRepository: repository } = await import("../repositories/cs2-catalog.repository.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    await db.delete(schema.series).where(eq(schema.series.gridSeriesId, gridSeriesId));
    await db.delete(schema.cs2Teams).where(inArray(schema.cs2Teams.gridTeamId, [firstGridTeamId, secondGridTeamId]));
    await db.delete(schema.cs2Competitions).where(eq(schema.cs2Competitions.gridTournamentId, gridTournamentId));
  });

  it("fills a TBD slot, updates metadata, and preserves identity order and live-owned scores", async () => {
    const base = {
      gridSeriesId,
      competition: { gridTournamentId, name: "Major" },
      format: 3,
      scheduledStartTime: new Date("2026-09-01T12:00:00.000Z"),
      lifecycle: "upcoming" as const,
      isSupported: true,
    };
    const first = await repository.synchronizeSeries({
      ...base,
      teams: [{ gridTeamId: firstGridTeamId, name: "Team A" }],
    });
    expect(first.participantCount).toBe(1);

    await db
      .update(schema.cs2SeriesParticipants)
      .set({ score: 2 })
      .where(eq(schema.cs2SeriesParticipants.seriesId, first.seriesId));
    await db
      .update(schema.series)
      .set({ catalogLifecycle: "live" })
      .where(eq(schema.series.id, first.seriesId));

    const completed = await repository.synchronizeSeries({
      ...base,
      competition: { gridTournamentId, name: "Major Renamed", shortName: "MR" },
      teams: [
        { gridTeamId: secondGridTeamId, name: "Team B" },
        { gridTeamId: firstGridTeamId, name: "Team A Renamed" },
      ],
    });
    expect(completed).toEqual({ seriesId: first.seriesId, participantCount: 2 });

    const participants = await db
      .select({
        gridTeamId: schema.cs2Teams.gridTeamId,
        name: schema.cs2Teams.name,
        displayOrder: schema.cs2SeriesParticipants.displayOrder,
        score: schema.cs2SeriesParticipants.score,
      })
      .from(schema.cs2SeriesParticipants)
      .innerJoin(schema.cs2Teams, eq(schema.cs2SeriesParticipants.teamId, schema.cs2Teams.id))
      .where(eq(schema.cs2SeriesParticipants.seriesId, first.seriesId))
      .orderBy(asc(schema.cs2SeriesParticipants.displayOrder));
    expect(participants).toEqual([
      { gridTeamId: firstGridTeamId, name: "Team A Renamed", displayOrder: 1, score: 2 },
      { gridTeamId: secondGridTeamId, name: "Team B", displayOrder: 2, score: 0 },
    ]);

    const [competition] = await db
      .select({ name: schema.cs2Competitions.name, shortName: schema.cs2Competitions.shortName })
      .from(schema.cs2Competitions)
      .where(eq(schema.cs2Competitions.gridTournamentId, gridTournamentId));
    expect(competition).toEqual({ name: "Major Renamed", shortName: "MR" });

    const [persistedSeries] = await db
      .select({ lifecycle: schema.series.catalogLifecycle })
      .from(schema.series)
      .where(eq(schema.series.id, first.seriesId));
    expect(persistedSeries?.lifecycle).toBe("live");
  });
});
