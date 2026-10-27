import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("arenaResultRepository (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let repository: typeof import("../repositories/arena-result.repository.js")["arenaResultRepository"];

  const runId = randomUUID();
  const competitionIds: string[] = [];
  const seriesIds: string[] = [];
  const matchIds: string[] = [];
  const arenaIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ arenaResultRepository: repository } = await import("../repositories/arena-result.repository.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (arenaIds.length > 0) {
      await db.delete(schema.arenaResults).where(inArray(schema.arenaResults.arenaId, arenaIds));
      await db.delete(schema.arenas).where(inArray(schema.arenas.id, arenaIds));
    }
    if (matchIds.length > 0) await db.delete(schema.matches).where(inArray(schema.matches.id, matchIds));
    if (seriesIds.length > 0) await db.delete(schema.series).where(inArray(schema.series.id, seriesIds));
    if (competitionIds.length > 0) await db.delete(schema.cs2Competitions).where(inArray(schema.cs2Competitions.id, competitionIds));
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  async function seedArena(name: string): Promise<{ arenaId: string; competitionId: string }> {
    const [competition] = await db.insert(schema.cs2Competitions)
      .values({ gridTournamentId: `arena-result-${name}-${runId}`, name: `Arena Result ${name}` })
      .returning();
    competitionIds.push(competition!.id);
    const [series] = await db.insert(schema.series).values({
      gridSeriesId: `arena-result-${name}-${runId}`,
      competitionId: competition!.id,
      format: 3,
      scheduledStartTime: new Date(),
      status: "active",
    }).returning();
    seriesIds.push(series!.id);
    const [match] = await db.insert(schema.matches).values({
      discipline: "cs2",
      seriesId: series!.id,
      seriesMatchIndex: 0,
      startTime: new Date(),
      status: "finished",
      currentMinute: 0,
      period: "pre",
    }).returning();
    matchIds.push(match!.id);
    const [arena] = await db.insert(schema.arenas).values({
      matchId: match!.id,
      status: "finished",
      mode: "classic",
      activePlayersCount: 0,
      entryFeeLamports: 0,
      prizePoolLamports: 0,
      escrowAccount: `arena-result-escrow-${name}-${runId}`,
    }).returning();
    arenaIds.push(arena!.id);
    return { arenaId: arena!.id, competitionId: competition!.id };
  }

  async function seedUser(name: string): Promise<string> {
    const [user] = await db.insert(schema.users).values({ walletAddress: `arena-result-${name}-${runId}`, username: name }).returning();
    userIds.push(user!.id);
    return user!.id;
  }

  const finishedAt = new Date("2026-10-27T12:00:00.000Z");

  it("keeps the first rows when an arena's results are written again", async () => {
    const { arenaId, competitionId } = await seedArena("repeat");
    const userId = await seedUser("repeat-player");
    const row = { arenaId, userId, competitionId, score: 7, rank: 1, won: true, roundsPlayed: 13, playersCount: 4, finishedAt };

    await repository.insertMany([row]);
    await repository.insertMany([{ ...row, score: 99, rank: 3, won: false }]);

    expect(await repository.listByCompetitions([competitionId])).toEqual([row]);
  });

  it("lists only the rows of the given competitions", async () => {
    const first = await seedArena("first");
    const second = await seedArena("second");
    const other = await seedArena("other");
    const userId = await seedUser("multi-player");
    const result = (arena: { arenaId: string; competitionId: string }, score: number) =>
      ({ ...arena, userId, score, rank: 2, won: false, roundsPlayed: 9, playersCount: 5, finishedAt });

    await repository.insertMany([result(first, 3), result(second, 5), result(other, 8)]);

    const rows = await repository.listByCompetitions([first.competitionId, second.competitionId]);
    expect(rows.map((row) => row.score).sort((a, b) => a - b)).toEqual([3, 5]);
    expect(await repository.listByCompetitions([])).toEqual([]);
  });
});
