import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

// Uses scopes by id only: the single current scope is shared DB state other test files may set.
describe.skipIf(!RUN)("recomputeScope (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let leaderboardRepository: typeof import("../../db/repositories/leaderboard.repository.js")["leaderboardRepository"];
  let arenaResultRepository: typeof import("../../db/repositories/arena-result.repository.js")["arenaResultRepository"];
  let recomputeScope: typeof import("../recompute.js")["recomputeScope"];

  const runId = randomUUID();
  const scopeIds: string[] = [];
  const competitionIds: string[] = [];
  const seriesIds: string[] = [];
  const matchIds: string[] = [];
  const arenaIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ leaderboardRepository } = await import("../../db/repositories/leaderboard.repository.js"));
    ({ arenaResultRepository } = await import("../../db/repositories/arena-result.repository.js"));
    ({ recomputeScope } = await import("../recompute.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (scopeIds.length > 0) await db.delete(schema.leaderboardScopes).where(inArray(schema.leaderboardScopes.id, scopeIds));
    if (arenaIds.length > 0) {
      await db.delete(schema.payouts).where(inArray(schema.payouts.arenaId, arenaIds));
      await db.delete(schema.arenaResults).where(inArray(schema.arenaResults.arenaId, arenaIds));
      await db.delete(schema.arenas).where(inArray(schema.arenas.id, arenaIds));
    }
    if (matchIds.length > 0) await db.delete(schema.matches).where(inArray(schema.matches.id, matchIds));
    if (seriesIds.length > 0) await db.delete(schema.series).where(inArray(schema.series.id, seriesIds));
    if (competitionIds.length > 0) await db.delete(schema.cs2Competitions).where(inArray(schema.cs2Competitions.id, competitionIds));
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  async function seedCompetition(name: string): Promise<string> {
    const [competition] = await db.insert(schema.cs2Competitions)
      .values({ gridTournamentId: `recompute-${name}-${runId}`, name })
      .returning();
    competitionIds.push(competition!.id);
    return competition!.id;
  }

  async function seedArena(competitionId: string, name: string): Promise<string> {
    const [series] = await db.insert(schema.series).values({
      gridSeriesId: `recompute-${name}-${runId}`,
      competitionId,
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
      escrowAccount: `recompute-escrow-${name}-${runId}`,
    }).returning();
    arenaIds.push(arena!.id);
    return arena!.id;
  }

  async function seedUser(name: string): Promise<string> {
    const [user] = await db.insert(schema.users).values({ walletAddress: `recompute-${name}-${runId}`, username: name }).returning();
    userIds.push(user!.id);
    return user!.id;
  }

  it("ranks only the scope's competitions, counts only sent payouts, and repeats the same rows", async () => {
    const counted = await seedCompetition("Counted Cup");
    const ignored = await seedCompetition("Ignored Cup");
    const countedArena = await seedArena(counted, "counted");
    const ignoredArena = await seedArena(ignored, "ignored");
    const [winner, runnerUp, outsider] = [await seedUser("winner"), await seedUser("runner-up"), await seedUser("outsider")];
    const row = (arenaId: string, competitionId: string, userId: string, score: number, rank: number, won: boolean) =>
      ({ arenaId, competitionId, userId, score, rank, won, roundsPlayed: 12, playersCount: 2, finishedAt: new Date() });
    await arenaResultRepository.insertMany([
      row(countedArena, counted, winner!, 9, 1, true),
      row(countedArena, counted, runnerUp!, 4, 2, false),
      row(ignoredArena, ignored, outsider!, 20, 1, true),
    ]);
    await db.insert(schema.payouts).values([
      { arenaId: countedArena, userId: winner!, amountLamports: 1800, status: "sent" },
      { arenaId: countedArena, userId: runnerUp!, amountLamports: 300, status: "pending" },
    ]);

    const scope = await leaderboardRepository.createScope(`Recompute ${runId}`);
    scopeIds.push(scope.id);
    await leaderboardRepository.addCompetition(scope.id, counted);

    expect(await recomputeScope(scope.id, new Date("2026-10-27T12:00:00.000Z"))).toBe(true);
    const first = await leaderboardRepository.topEntries(scope.id, 10);
    expect(first.map((entry) => [entry.userId, entry.rank, entry.points, entry.wins, entry.secondPlaces, entry.totalPayoutLamports]))
      .toEqual([[winner, 1, 9, 1, 0, 1800], [runnerUp, 2, 4, 0, 1, 0]]);

    expect(await recomputeScope(scope.id, new Date("2026-10-27T12:15:00.000Z"))).toBe(true);
    const second = await leaderboardRepository.topEntries(scope.id, 10);
    expect(second.map(({ computedAt: _, ...entry }) => entry)).toEqual(first.map(({ computedAt: _, ...entry }) => entry));
  });

  it("leaves a closed scope's rows alone", async () => {
    const scope = await leaderboardRepository.createScope(`Closed ${runId}`);
    scopeIds.push(scope.id);
    await db.update(schema.leaderboardScopes).set({ status: "closed", closedAt: new Date() }).where(inArray(schema.leaderboardScopes.id, [scope.id]));

    expect(await recomputeScope(scope.id)).toBe(false);
    expect(await recomputeScope(randomUUID())).toBe(false);
  });
});
