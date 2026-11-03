import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("leaderboardRepository (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let repository: typeof import("../repositories/leaderboard.repository.js")["leaderboardRepository"];

  const runId = randomUUID();
  const scopeIds: string[] = [];
  const competitionIds: string[] = [];
  const userIds: string[] = [];
  const seriesIds: string[] = [];
  const matchIds: string[] = [];
  const arenaIds: string[] = [];
  // These tests switch the single current scope, which closes one a developer left current in this database.
  let currentBefore: string | undefined;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
    schema = await import("../schema.js");
    ({ leaderboardRepository: repository } = await import("../repositories/leaderboard.repository.js"));
    currentBefore = (await repository.findCurrent())?.id;
  });

  afterAll(async () => {
    if (db === undefined) return;
    // Entries and scope competitions cascade with their scope.
    if (scopeIds.length > 0) await db.delete(schema.leaderboardScopes).where(inArray(schema.leaderboardScopes.id, scopeIds));
    if (arenaIds.length > 0) {
      await db.delete(schema.arenaResults).where(inArray(schema.arenaResults.arenaId, arenaIds));
      await db.delete(schema.arenas).where(inArray(schema.arenas.id, arenaIds));
    }
    if (matchIds.length > 0) await db.delete(schema.matches).where(inArray(schema.matches.id, matchIds));
    if (seriesIds.length > 0) await db.delete(schema.series).where(inArray(schema.series.id, seriesIds));
    if (competitionIds.length > 0) await db.delete(schema.cs2Competitions).where(inArray(schema.cs2Competitions.id, competitionIds));
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    if (currentBefore !== undefined) {
      await db.update(schema.leaderboardScopes)
        .set({ status: "open", isCurrent: true, closedAt: null })
        .where(eq(schema.leaderboardScopes.id, currentBefore));
    }
  });

  async function createScope(name: string) {
    const scope = await repository.createScope(`${name} ${runId}`);
    scopeIds.push(scope.id);
    return scope;
  }

  async function seedCompetition(name: string): Promise<string> {
    const [competition] = await db.insert(schema.cs2Competitions)
      .values({ gridTournamentId: `leaderboard-${name}-${runId}`, name })
      .returning();
    competitionIds.push(competition!.id);
    return competition!.id;
  }

  async function seedUser(name: string): Promise<string> {
    const [user] = await db.insert(schema.users).values({ walletAddress: `leaderboard-${name}-${runId}`, username: name }).returning();
    userIds.push(user!.id);
    return user!.id;
  }

  it("keeps one current scope: making another current closes the old one, and a closed one never comes back", async () => {
    const first = await createScope("First");
    const second = await createScope("Second");
    expect(first).toMatchObject({ status: "open", isCurrent: false, closedAt: null });

    expect(await repository.setCurrent(first.id)).toBe(true);
    expect((await repository.findCurrent())?.id).toBe(first.id);

    expect(await repository.setCurrent(second.id)).toBe(true);
    expect((await repository.findCurrent())?.id).toBe(second.id);
    const closed = await repository.findScope(first.id);
    expect(closed).toMatchObject({ status: "closed", isCurrent: false });
    expect(closed?.closedAt).toBeInstanceOf(Date);

    expect(await repository.setCurrent(first.id)).toBe(false);
    expect((await repository.findCurrent())?.id).toBe(second.id);

    await expect(db.insert(schema.leaderboardScopes).values({ name: `Rogue ${runId}`, isCurrent: true })).rejects.toThrow();

    expect(await repository.closeCurrent()).toBe(true);
    expect(await repository.findCurrent()).toBeUndefined();
    expect(await repository.closeCurrent()).toBe(false);
  });

  it("lets a closed scope be renamed but never changes its competitions", async () => {
    const scope = await createScope("Season");
    const kept = await seedCompetition("Kept Cup");
    const later = await seedCompetition("Later Cup");

    expect(await repository.addCompetition(scope.id, kept)).toBe(true);
    expect(await repository.addCompetition(scope.id, kept)).toBe(true);
    expect(await repository.addCompetition(scope.id, later)).toBe(true);
    expect(await repository.removeCompetition(scope.id, later)).toBe(true);
    expect(await repository.listCompetitionIds(scope.id)).toEqual([kept]);

    await repository.setCurrent(scope.id);
    await repository.closeCurrent();

    expect(await repository.addCompetition(scope.id, later)).toBe(false);
    expect(await repository.removeCompetition(scope.id, kept)).toBe(false);
    expect(await repository.listCompetitionIds(scope.id)).toEqual([kept]);

    expect(await repository.renameScope(scope.id, `Season renamed ${runId}`)).toBe(true);
    expect((await repository.findScope(scope.id))?.name).toBe(`Season renamed ${runId}`);
  });

  it("replaces a scope's entries in full and reads them by rank", async () => {
    const scope = await createScope("Entries");
    const [a, b, c] = [await seedUser("entry-a"), await seedUser("entry-b"), await seedUser("entry-c")];
    const entry = (userId: string, rank: number, points: number) =>
      ({ userId, rank, points, arenasPlayed: 2, wins: 1, secondPlaces: 0, roundsPlayed: 20, totalScore: points, totalPayoutLamports: 500 });
    const firstRun = new Date("2026-10-27T12:00:00.000Z");
    const secondRun = new Date("2026-10-27T12:15:00.000Z");

    expect(await repository.replaceEntries(scope.id, async () => [entry(a!, 2, 5), entry(b!, 1, 9)], firstRun)).toBe(true);
    expect(await repository.replaceEntries(scope.id, async () => [entry(c!, 1, 12), entry(a!, 2, 7)], secondRun)).toBe(true);

    const top = await repository.topEntries(scope.id, 10);
    expect(top.map((row) => [row.userId, row.rank, row.points])).toEqual([[c, 1, 12], [a, 2, 7]]);
    expect(top.every((row) => row.computedAt.getTime() === secondRun.getTime())).toBe(true);
    expect(await repository.topEntries(scope.id, 1)).toHaveLength(1);
    expect(await repository.entryFor(scope.id, b!)).toBeUndefined();
    expect((await repository.entryFor(scope.id, a!))?.points).toBe(7);
  });

  it("computes only once it holds the scope lock, and never computes or writes a closed scope", async () => {
    const scope = await createScope("Locked");
    const player = await seedUser("locked-a");
    const entry = { userId: player, rank: 1, points: 5, arenasPlayed: 1, wins: 1, secondPlaces: 0, roundsPlayed: 10, totalScore: 5, totalPayoutLamports: 0 };

    let markLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { markLocked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: schema.leaderboardScopes.id }).from(schema.leaderboardScopes).where(eq(schema.leaderboardScopes.id, scope.id)).for("update");
      markLocked();
      await released;
    });
    await locked;

    let computed = false;
    const write = repository.replaceEntries(scope.id, async () => {
      computed = true;
      return [entry];
    }, new Date());
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(computed).toBe(false);
    } finally {
      // Always let go, so a regression fails here instead of hanging on the held lock.
      release();
      await holder;
    }
    await expect(write).resolves.toBe(true);
    expect((await repository.topEntries(scope.id, 10)).map((row) => row.userId)).toEqual([player]);

    await repository.setCurrent(scope.id);
    await repository.closeCurrent();
    computed = false;
    expect(await repository.replaceEntries(scope.id, async () => {
      computed = true;
      return [];
    }, new Date())).toBe(false);
    expect(computed).toBe(false);
    expect((await repository.topEntries(scope.id, 10)).map((row) => row.userId)).toEqual([player]);
  });

  it("lists competitions with their scopes, arenas with results, and whether a series is still to come", async () => {
    const running = await seedCompetition(`Running Cup ${runId}`);
    const done = await seedCompetition(`Done Cup ${runId}`);
    const scope = await createScope("Admin list");
    await repository.addCompetition(scope.id, running);
    const userId = await seedUser("admin-list-player");

    const seedSeries = async (competitionId: string, name: string, catalogLifecycle: "upcoming" | "completed") => {
      const [row] = await db.insert(schema.series).values({
        gridSeriesId: `leaderboard-${name}-${runId}`,
        competitionId,
        format: 3,
        scheduledStartTime: new Date(),
        status: "active",
        catalogLifecycle,
      }).returning();
      seriesIds.push(row!.id);
      return row!.id;
    };
    await seedSeries(running, "running-next", "upcoming");
    const playedSeries = await seedSeries(running, "running-played", "completed");
    await seedSeries(done, "done-played", "completed");

    const [match] = await db.insert(schema.matches).values({
      discipline: "cs2", seriesId: playedSeries, seriesMatchIndex: 0, startTime: new Date(), status: "finished", currentMinute: 0, period: "pre",
    }).returning();
    matchIds.push(match!.id);
    const [arena] = await db.insert(schema.arenas).values({
      matchId: match!.id, status: "finished", mode: "classic", activePlayersCount: 0, entryFeeLamports: 0, prizePoolLamports: 0,
      escrowAccount: `leaderboard-escrow-${runId}`,
    }).returning();
    arenaIds.push(arena!.id);
    await db.insert(schema.arenaResults).values({
      arenaId: arena!.id, userId, competitionId: running, score: 4, rank: 1, won: true, roundsPlayed: 10, playersCount: 1, finishedAt: new Date(),
    });

    const rows = (await repository.listAdminCompetitions()).filter((row) => row.id === running || row.id === done);
    expect(rows.find((row) => row.id === running)).toMatchObject({ scopeIds: [scope.id], arenasWithResults: 1, unfinished: true });
    expect(rows.find((row) => row.id === done)).toMatchObject({ scopeIds: [], arenasWithResults: 0, unfinished: false });
    expect(await repository.listScopeCompetitions(scope.id)).toEqual([{ name: `Running Cup ${runId}`, shortName: null, logoUrl: null }]);
  });
});
