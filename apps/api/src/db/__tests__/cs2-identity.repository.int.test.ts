import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("cs2IdentityRepository (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let seriesRepository: typeof import("../repositories/series.repository.js")["seriesRepository"];
  let cs2IdentityRepository: typeof import("../repositories/cs2-identity.repository.js")["cs2IdentityRepository"];
  let matchRepository: typeof import("../repositories/match.repository.js")["matchRepository"];

  const runId = randomUUID();
  const gridSeriesId = `identity-series-${runId}`;
  const concurrencyGridSeriesId = `identity-concurrency-series-${runId}`;
  const firstGridTeamId = `identity-team-a-${runId}`;
  const secondGridTeamId = `identity-team-b-${runId}`;
  const unknownGridTeamId = `identity-team-c-${runId}`;
  let seriesId: string;
  let concurrencySeriesId: string | undefined;
  let matchId: string | undefined;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ seriesRepository } = await import("../repositories/series.repository.js"));
    ({ cs2IdentityRepository } = await import("../repositories/cs2-identity.repository.js"));
    ({ matchRepository } = await import("../repositories/match.repository.js"));

    const series = await seriesRepository.upsertByGridSeriesId(gridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(),
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (matchId !== undefined) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    if (concurrencySeriesId !== undefined) {
      await db.delete(schema.matches).where(eq(schema.matches.seriesId, concurrencySeriesId));
    }
    await db.delete(schema.series).where(inArray(
      schema.series.id,
      [seriesId, concurrencySeriesId].filter((id): id is string => id !== undefined),
    ));
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

  it("reconciles identities before the first Match, then freezes the Series pair", async () => {
    const reconciled = await cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
      { gridTeamId: firstGridTeamId, name: "Team A", score: 2 },
      { gridTeamId: unknownGridTeamId, name: "Team C", score: 1 },
    ]);
    expect(reconciled.map((team) => team.gridTeamId)).toEqual([firstGridTeamId, unknownGridTeamId]);

    const match = await matchRepository.upsertForSeriesMap(seriesId, 1, {
      teams: reconciled.map(({ teamId, name }) => ({ teamId, name })) as [
        { teamId: string; name: string },
        { teamId: string; name: string },
      ],
      startTime: new Date(),
    });
    matchId = match.id;

    await expect(cs2IdentityRepository.synchronizeSeriesTeams(seriesId, [
      { gridTeamId: firstGridTeamId, name: "Team A", score: 2 },
      { gridTeamId: secondGridTeamId, name: "Team B", score: 1 },
    ])).rejects.toThrow(`CS2 series ${seriesId} team identities changed after Match creation`);

    const rows = await db
      .select({ gridTeamId: schema.cs2Teams.gridTeamId })
      .from(schema.cs2SeriesParticipants)
      .innerJoin(schema.cs2Teams, eq(schema.cs2SeriesParticipants.teamId, schema.cs2Teams.id))
      .where(eq(schema.cs2SeriesParticipants.seriesId, seriesId));
    expect(rows.map((row) => row.gridTeamId).sort()).toEqual([firstGridTeamId, unknownGridTeamId].sort());

    const [rogueTeam] = await db
      .select({ id: schema.cs2Teams.id })
      .from(schema.cs2Teams)
      .where(eq(schema.cs2Teams.gridTeamId, secondGridTeamId));
    expect(rogueTeam).toBeDefined();
    await db.insert(schema.cs2MatchTeamScores).values({ matchId: match.id, teamId: rogueTeam!.id, score: 0 });
    await expect(matchRepository.upsertForSeriesMap(seriesId, 1, {
      teams: reconciled.map(({ teamId, name }) => ({ teamId, name })) as [
        { teamId: string; name: string },
        { teamId: string; name: string },
      ],
      startTime: new Date(),
    })).rejects.toThrow(`CS2 match ${match.id} team identities changed`);
  });

  it("serializes participant replacement against first Match creation", async () => {
    const concurrencySeries = await seriesRepository.upsertByGridSeriesId(concurrencyGridSeriesId, {
      format: 3,
      scheduledStartTime: new Date(),
    });
    concurrencySeriesId = concurrencySeries.id;
    const initial = await cs2IdentityRepository.synchronizeSeriesTeams(concurrencySeries.id, [
      { gridTeamId: firstGridTeamId, name: "Team A", score: 0 },
      { gridTeamId: secondGridTeamId, name: "Team B", score: 0 },
    ]);
    const teams = initial.map(({ teamId, name }) => ({ teamId, name })) as [
      { teamId: string; name: string },
      { teamId: string; name: string },
    ];

    const [matchResult, replacementResult] = await Promise.allSettled([
      matchRepository.upsertForSeriesMap(concurrencySeries.id, 1, { teams, startTime: new Date() }),
      cs2IdentityRepository.synchronizeSeriesTeams(concurrencySeries.id, [
        { gridTeamId: firstGridTeamId, name: "Team A", score: 0 },
        { gridTeamId: unknownGridTeamId, name: "Team C", score: 0 },
      ]),
    ]);

    expect([matchResult.status, replacementResult.status].sort()).toEqual(["fulfilled", "rejected"]);
    const participants = await db
      .select({ gridTeamId: schema.cs2Teams.gridTeamId })
      .from(schema.cs2SeriesParticipants)
      .innerJoin(schema.cs2Teams, eq(schema.cs2SeriesParticipants.teamId, schema.cs2Teams.id))
      .where(eq(schema.cs2SeriesParticipants.seriesId, concurrencySeries.id));
    expect(participants.map((team) => team.gridTeamId).sort()).toEqual(
      (matchResult.status === "fulfilled"
        ? [firstGridTeamId, secondGridTeamId]
        : [firstGridTeamId, unknownGridTeamId]).sort(),
    );
  });
});
