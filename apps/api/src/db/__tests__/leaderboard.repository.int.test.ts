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
    // Entries, scope competitions, prizes and marks cascade with their scope.
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

  async function seedCompetition(name: string, createdAt?: Date): Promise<string> {
    const [competition] = await db.insert(schema.cs2Competitions)
      .values({ gridTournamentId: `leaderboard-${name}-${runId}`, name, ...(createdAt !== undefined ? { createdAt } : {}) })
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

    expect(await repository.setCurrent(first.id, currentBefore ?? null)).toBe("switched");
    expect((await repository.findCurrent())?.id).toBe(first.id);

    expect(await repository.setCurrent(second.id, first.id)).toBe("switched");
    expect((await repository.findCurrent())?.id).toBe(second.id);
    const closed = await repository.findScope(first.id);
    expect(closed).toMatchObject({ status: "closed", isCurrent: false });
    expect(closed?.closedAt).toBeInstanceOf(Date);

    expect(await repository.setCurrent(first.id, second.id)).toBe("closed");
    expect((await repository.findCurrent())?.id).toBe(second.id);

    await expect(db.insert(schema.leaderboardScopes).values({ name: `Rogue ${runId}`, isCurrent: true })).rejects.toThrow();

    expect(await repository.closeCurrent(second.id)).toBe(true);
    expect(await repository.findCurrent()).toBeUndefined();
    expect(await repository.closeCurrent(second.id)).toBe(false);
  });

  it("switches or closes only the scope the caller expects to be current", async () => {
    const current = await createScope("Expected");
    const other = await createScope("Other");
    const next = await createScope("Next");
    expect(await repository.setCurrent(current.id, null)).toBe("switched");

    // A stale view: the caller still thinks `other` (or none) is current.
    expect(await repository.setCurrent(next.id, other.id)).toBe("current_changed");
    expect(await repository.setCurrent(next.id, null)).toBe("current_changed");
    expect(await repository.closeCurrent(other.id)).toBe(false);
    expect((await repository.findCurrent())?.id).toBe(current.id);
    expect(await repository.findScope(next.id)).toMatchObject({ status: "open", isCurrent: false });
    expect(await repository.findScope(other.id)).toMatchObject({ status: "open", isCurrent: false });

    expect(await repository.closeCurrent(current.id)).toBe(true);
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

    await repository.setCurrent(scope.id, null);
    await repository.closeCurrent(scope.id);

    expect(await repository.addCompetition(scope.id, later)).toBe(false);
    expect(await repository.removeCompetition(scope.id, kept)).toBe(false);
    expect(await repository.listCompetitionIds(scope.id)).toEqual([kept]);

    expect(await repository.renameScope(scope.id, `Season renamed ${runId}`)).toBe(true);
    expect((await repository.findScope(scope.id))?.name).toBe(`Season renamed ${runId}`);
  });

  it("sets, replaces and removes prizes by place, and never changes a closed scope's prizes", async () => {
    const scope = await createScope("Prizes");
    const awp = "https://cdn.example.com/skins/awp.png";
    const ak = "https://cdn.example.com/skins/ak.png";

    expect(await repository.setPrize(scope.id, 2, ak)).toBe(true);
    expect(await repository.setPrize(scope.id, 1, ak)).toBe(true);
    expect(await repository.setPrize(scope.id, 1, awp)).toBe(true);
    expect(await repository.setPrize(scope.id, 3, ak)).toBe(true);
    expect(await repository.removePrize(scope.id, 3)).toBe(true);
    expect(await repository.listPrizes(scope.id)).toEqual([{ place: 1, imageUrl: awp }, { place: 2, imageUrl: ak }]);
    expect((await repository.listAllPrizes()).filter((prize) => prize.scopeId === scope.id)).toEqual([
      { scopeId: scope.id, place: 1, imageUrl: awp },
      { scopeId: scope.id, place: 2, imageUrl: ak },
    ]);

    await db.update(schema.leaderboardScopes).set({ status: "closed", closedAt: new Date() }).where(eq(schema.leaderboardScopes.id, scope.id));

    expect(await repository.setPrize(scope.id, 1, ak)).toBe(false);
    expect(await repository.setPrize(scope.id, 4, ak)).toBe(false);
    expect(await repository.removePrize(scope.id, 2)).toBe(false);
    expect(await repository.listPrizes(scope.id)).toEqual([{ place: 1, imageUrl: awp }, { place: 2, imageUrl: ak }]);
  });

  it("stages mark drafts and applies them all at once, a clear removing the mark", async () => {
    const scope = await createScope("Marks");
    const [cheat, valid, lifted] = await Promise.all([seedUser("marks-cheat"), seedUser("marks-valid"), seedUser("marks-lifted")]);

    expect(await repository.setMarkDraft(scope.id, cheat, "approve", null, "first-admin")).toBe(true);
    expect(await repository.setMarkDraft(scope.id, cheat, "disqualify", "Second account", "second-admin")).toBe(true);
    expect(await repository.setMarkDraft(scope.id, valid, "approve", null, "second-admin")).toBe(true);
    expect(await repository.setMarkDraft(scope.id, lifted, "disqualify", "Shared wallet", "second-admin")).toBe(true);
    expect(await repository.removeMarkDraft(scope.id, lifted)).toBe(true);
    expect((await repository.listMarkDrafts(scope.id)).map(({ userId, action, reason, actorLogin }) => ({ userId, action, reason, actorLogin })))
      .toEqual(expect.arrayContaining([
        { userId: cheat, action: "disqualify", reason: "Second account", actorLogin: "second-admin" },
        { userId: valid, action: "approve", reason: null, actorLogin: "second-admin" },
      ]));
    expect(await repository.listMarks(scope.id)).toEqual([]);

    expect(await repository.setMarkDraft(scope.id, lifted, "disqualify", "Shared wallet", "second-admin")).toBe(true);
    expect(await repository.applyMarkDrafts(scope.id)).toBe(3);
    expect(await repository.listMarkDrafts(scope.id)).toEqual([]);
    const marks = async () => (await repository.listMarks(scope.id)).map(({ userId, status, reason }) => ({ userId, status, reason }));
    expect(await marks()).toEqual(expect.arrayContaining([
      { userId: cheat, status: "disqualified", reason: "Second account" },
      { userId: valid, status: "approved", reason: null },
      { userId: lifted, status: "disqualified", reason: "Shared wallet" },
    ]));
    expect(await marks()).toHaveLength(3);

    expect(await repository.setMarkDraft(scope.id, lifted, "clear", null, "first-admin")).toBe(true);
    expect(await repository.setMarkDraft(scope.id, cheat, "approve", null, "first-admin")).toBe(true);
    expect(await repository.applyMarkDrafts(scope.id)).toBe(2);
    expect(await marks()).toEqual(expect.arrayContaining([
      { userId: cheat, status: "approved", reason: null },
      { userId: valid, status: "approved", reason: null },
    ]));
    expect(await marks()).toHaveLength(2);
    expect(await repository.applyMarkDrafts(scope.id)).toBe(0);
  });

  it("never stages or applies marks on a closed scope", async () => {
    const scope = await createScope("Closed marks");
    const player = await seedUser("closed-marks");
    expect(await repository.setMarkDraft(scope.id, player, "approve", null, "admin")).toBe(true);

    await db.update(schema.leaderboardScopes).set({ status: "closed", closedAt: new Date() }).where(eq(schema.leaderboardScopes.id, scope.id));

    expect(await repository.applyMarkDrafts(scope.id)).toBe(false);
    expect(await repository.setMarkDraft(scope.id, player, "disqualify", "Late", "admin")).toBe(false);
    expect(await repository.removeMarkDraft(scope.id, player)).toBe(false);
    expect(await repository.listMarks(scope.id)).toEqual([]);
    expect((await repository.listMarkDrafts(scope.id)).map((draft) => draft.action)).toEqual(["approve"]);
  });

  it("applies marks only after a running recompute releases the scope lock", async () => {
    const scope = await createScope("Apply lock");
    const player = await seedUser("apply-lock");
    const entry = { userId: player, rank: 1, points: 5, arenasPlayed: 1, wins: 1, secondPlaces: 0, roundsPlayed: 10, totalScore: 5, totalPayoutLamports: 0, disqualified: false };
    await repository.setMarkDraft(scope.id, player, "disqualify", "Second account", "admin");

    let markComputing!: () => void;
    let finishCompute!: () => void;
    const computing = new Promise<void>((resolve) => { markComputing = resolve; });
    const computeDone = new Promise<void>((resolve) => { finishCompute = resolve; });
    let marksSeenByRecompute: unknown[] | undefined;
    const recompute = repository.replaceEntries(scope.id, async () => {
      markComputing();
      await computeDone;
      marksSeenByRecompute = await repository.listMarks(scope.id);
      return [entry];
    }, new Date());
    await computing;

    let applied = false;
    const apply = repository.applyMarkDrafts(scope.id).then((count) => {
      applied = true;
      return count;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(applied).toBe(false);
    } finally {
      // Always let go, so a regression fails here instead of hanging on the held lock.
      finishCompute();
      await recompute;
    }
    await expect(apply).resolves.toBe(1);
    expect(marksSeenByRecompute).toEqual([]);
    expect((await repository.listMarks(scope.id)).map((mark) => mark.status)).toEqual(["disqualified"]);
  });

  describe("finalize", () => {
    const entry = (userId: string, rank: number, points: number, disqualified = false) =>
      ({ userId, rank, points, arenasPlayed: 1, wins: 0, secondPlaces: 0, roundsPlayed: 10, totalScore: points, totalPayoutLamports: 0, disqualified });

    async function currentScope(name: string) {
      const scope = await createScope(name);
      const previous = await repository.findCurrent();
      expect(await repository.setCurrent(scope.id, previous?.id ?? null)).toBe("switched");
      return scope;
    }

    // Claims get a repository read with the winners' admin view; until then the test reads the table.
    async function claims(scopeId: string) {
      return db.select({ place: schema.leaderboardPrizeClaims.place, userId: schema.leaderboardPrizeClaims.userId })
        .from(schema.leaderboardPrizeClaims)
        .where(eq(schema.leaderboardPrizeClaims.scopeId, scopeId))
        .orderBy(schema.leaderboardPrizeClaims.place);
    }

    const noEntries = async () => [];

    async function approve(scopeId: string, ...userIds: string[]) {
      for (const userId of userIds) await repository.setMarkDraft(scopeId, userId, "approve", null, "admin");
      await repository.applyMarkDrafts(scopeId);
    }

    it("refuses a scope that isn't open and current, has no prizes, or has staged changes", async () => {
      const prepared = await createScope("Finalize prepared");
      await repository.setPrize(prepared.id, 1, "https://cdn.example.com/skins/awp.png");
      expect(await repository.finalizeCurrent(prepared.id, noEntries)).toEqual({ kind: "current_changed" });

      const scope = await currentScope("Finalize checks");
      const player = await seedUser("finalize-check");
      expect(await repository.finalizeCurrent(scope.id, noEntries)).toEqual({ kind: "no_prizes" });

      await repository.setPrize(scope.id, 1, "https://cdn.example.com/skins/awp.png");
      await repository.setMarkDraft(scope.id, player, "approve", null, "admin");
      expect(await repository.finalizeCurrent(scope.id, noEntries)).toEqual({ kind: "drafts_pending" });

      expect((await repository.findScope(scope.id))).toMatchObject({ status: "open", isCurrent: true, finalizedAt: null });
      await repository.closeCurrent(scope.id);
    });

    it("refuses while a player on a prize place lacks an applied approval", async () => {
      const scope = await currentScope("Finalize unapproved");
      const [first, second, third] = [await seedUser("unapproved-first"), await seedUser("unapproved-second"), await seedUser("unapproved-third")];
      await repository.setPrize(scope.id, 1, "https://cdn.example.com/skins/awp.png");
      await repository.setPrize(scope.id, 2, "https://cdn.example.com/skins/ak.png");
      await approve(scope.id, first, third);

      const ranked = async () => [entry(first, 1, 30), entry(second, 2, 20), entry(third, 3, 10)];
      expect(await repository.finalizeCurrent(scope.id, ranked)).toEqual({ kind: "unapproved", usernames: ["unapproved-second"] });
      expect(await claims(scope.id)).toEqual([]);
      await repository.closeCurrent(scope.id);
    });

    it("gives places by position, skipping disqualified rows and spreading a tie, then closes and locks the scope", async () => {
      const scope = await currentScope("Finalize");
      const [cheat, tiedA, tiedB, fourth] = [await seedUser("final-cheat"), await seedUser("final-tied-a"), await seedUser("final-tied-b"), await seedUser("final-fourth")];
      for (const place of [1, 2, 3]) await repository.setPrize(scope.id, place, `https://cdn.example.com/skins/${place}.png`);
      // A stale stored board: finalize ranks again itself, so these rows never count.
      await repository.replaceEntries(scope.id, async () => [entry(fourth, 1, 99)], new Date());
      await approve(scope.id, tiedA, tiedB, fourth);

      const ranked = async () => [entry(cheat, 1, 50, true), entry(tiedA, 1, 40), entry(tiedB, 1, 40), entry(fourth, 3, 10)];
      expect(await repository.finalizeCurrent(scope.id, ranked)).toEqual({ kind: "finalized", claims: 3 });
      expect((await repository.topEntries(scope.id, 10)).map((row) => row.userId)).toEqual(expect.arrayContaining([cheat, tiedA, tiedB, fourth]));

      const [firstTied, secondTied] = [tiedA, tiedB].sort();
      expect(await claims(scope.id)).toEqual([
        { place: 1, userId: firstTied },
        { place: 2, userId: secondTied },
        { place: 3, userId: fourth },
      ]);
      const finalized = await repository.findScope(scope.id);
      expect(finalized).toMatchObject({ status: "closed", isCurrent: false });
      expect(finalized?.finalizedAt).toBeInstanceOf(Date);
      expect(await repository.findCurrent()).toBeUndefined();
      expect(await repository.setPrize(scope.id, 1, "https://cdn.example.com/skins/other.png")).toBe(false);
      expect(await repository.setMarkDraft(scope.id, fourth, "disqualify", "Late", "admin")).toBe(false);
      expect(await repository.finalizeCurrent(scope.id, noEntries)).toEqual({ kind: "current_changed" });
    });

    it("ranks and gives places under the lock, so a mark change made meanwhile waits and is then refused", async () => {
      const scope = await currentScope("Finalize lock");
      const [winner, late] = [await seedUser("lock-winner"), await seedUser("lock-late")];
      await repository.setPrize(scope.id, 1, "https://cdn.example.com/skins/awp.png");
      await approve(scope.id, winner);

      let markComputing!: () => void;
      let finishCompute!: () => void;
      const computing = new Promise<void>((resolve) => { markComputing = resolve; });
      const computeDone = new Promise<void>((resolve) => { finishCompute = resolve; });
      const finalize = repository.finalizeCurrent(scope.id, async () => {
        markComputing();
        await computeDone;
        return [entry(winner, 1, 20), entry(late, 2, 10)];
      });
      await computing;

      let staged: boolean | undefined;
      const draft = repository.setMarkDraft(scope.id, winner, "disqualify", "Second account", "admin").then((ok) => { staged = ok; return ok; });
      try {
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(staged).toBeUndefined();
      } finally {
        // Always let go, so a regression fails here instead of hanging on the held lock.
        finishCompute();
      }
      await expect(finalize).resolves.toEqual({ kind: "finalized", claims: 1 });
      await expect(draft).resolves.toBe(false);
      expect(await claims(scope.id)).toEqual([{ place: 1, userId: winner }]);
      expect(await repository.listMarkDrafts(scope.id)).toEqual([]);
    });
  });

  it("reads a disqualified row before the real player sharing its rank", async () => {
    const scope = await createScope("Board order");
    const [leader, cheat, real] = [await seedUser("order-leader"), await seedUser("order-cheat"), await seedUser("order-real")];
    const entry = (userId: string, rank: number, points: number, disqualified: boolean) =>
      ({ userId, rank, points, arenasPlayed: 1, wins: 0, secondPlaces: 0, roundsPlayed: 10, totalScore: points, totalPayoutLamports: 0, disqualified });
    // Both orders by userId, so the result can't depend on it.
    const [first, second] = [cheat, real].sort();
    expect(await repository.replaceEntries(scope.id, async () => [
      entry(leader, 1, 100, false),
      entry(second!, 2, second === cheat ? 90 : 80, second === cheat),
      entry(first!, 2, first === cheat ? 90 : 80, first === cheat),
    ], new Date())).toBe(true);

    expect((await repository.topEntries(scope.id, 10)).map((row) => [row.userId, row.rank, row.disqualified]))
      .toEqual([[leader, 1, false], [cheat, 2, true], [real, 2, false]]);
    expect((await repository.entryFor(scope.id, cheat))?.disqualified).toBe(true);
  });

  it("replaces a scope's entries in full and reads them by rank", async () => {
    const scope = await createScope("Entries");
    const [a, b, c] = [await seedUser("entry-a"), await seedUser("entry-b"), await seedUser("entry-c")];
    const entry = (userId: string, rank: number, points: number) =>
      ({ userId, rank, points, arenasPlayed: 2, wins: 1, secondPlaces: 0, roundsPlayed: 20, totalScore: points, totalPayoutLamports: 500, disqualified: false });
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

  it("writes a scope with more entries than one statement can bind", async () => {
    const scope = await createScope("Large");
    const players = await db.insert(schema.users)
      .values(Array.from({ length: 6000 }, (_, index) => ({ walletAddress: `leaderboard-large-${index}-${runId}`, username: `large-${index}` })))
      .returning({ id: schema.users.id });
    userIds.push(...players.map((player) => player.id));
    const entries = players.map((player, index) => ({
      userId: player.id, rank: index + 1, points: 6000 - index, arenasPlayed: 1, wins: 0, secondPlaces: 0, roundsPlayed: 1, totalScore: 6000 - index, totalPayoutLamports: 0, disqualified: false,
    }));

    expect(await repository.replaceEntries(scope.id, async () => entries)).toBe(true);
    const stored = await repository.topEntries(scope.id, 6000);
    expect(stored).toHaveLength(6000);
    expect(stored[0]?.rank).toBe(1);
  });

  it("computes only once it holds the scope lock, and never computes or writes a closed scope", async () => {
    const scope = await createScope("Locked");
    const player = await seedUser("locked-a");
    const entry = { userId: player, rank: 1, points: 5, arenasPlayed: 1, wins: 1, secondPlaces: 0, roundsPlayed: 10, totalScore: 5, totalPayoutLamports: 0, disqualified: false };

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

    await repository.setCurrent(scope.id, null);
    await repository.closeCurrent(scope.id);
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

    const rows = await repository.listAdminCompetitions(runId);
    expect(rows.find((row) => row.id === running)).toMatchObject({ scopeIds: [scope.id], arenasWithResults: 1, unfinished: true });
    expect(rows.find((row) => row.id === done)).toMatchObject({ scopeIds: [], arenasWithResults: 0, unfinished: false });
    expect(await repository.listScopeCompetitions(scope.id)).toEqual([{ name: `Running Cup ${runId}`, shortName: null, logoUrl: null }]);
  });

  describe("admin competition list", () => {
    // Synced "in the future", so they are the latest whatever else this database holds.
    const syncedAt = (minutes: number) => new Date(Date.now() + 24 * 60 * 60 * 1000 + minutes * 60 * 1000);
    const ids: string[] = [];
    let scopeId: string;

    beforeAll(async () => {
      for (let index = 0; index < 11; index += 1) {
        ids.push(await seedCompetition(`Latest Cup ${index} ${runId}`, syncedAt(index)));
      }
      scopeId = (await createScope("Summary")).id;
      await repository.addCompetition(scopeId, ids[0]!);
      await repository.addCompetition(scopeId, ids[10]!);
      const [row] = await db.insert(schema.series).values({
        gridSeriesId: `leaderboard-summary-${runId}`,
        competitionId: ids[0]!,
        format: 3,
        scheduledStartTime: new Date(),
        status: "active",
        catalogLifecycle: "live",
      }).returning();
      seriesIds.push(row!.id);
    });

    it("lists the 10 latest synced without a search, newest first", async () => {
      expect((await repository.listAdminCompetitions()).map((row) => row.id)).toEqual([...ids].reverse().slice(0, 10));
    });

    it("finds every competition whose name contains the search, in any case", async () => {
      const rows = await repository.listAdminCompetitions(`latest cup 0 ${runId}`.toUpperCase());
      expect(rows.map((row) => row.id)).toEqual([ids[0]]);
      expect((await repository.listAdminCompetitions(runId)).filter((row) => ids.includes(row.id))).toHaveLength(11);
    });

    it("matches % and _ in the search literally", async () => {
      const percent = await seedCompetition(`Cup 100% ${runId}`);
      const underscore = await seedCompetition(`Cup a_b ${runId}`);
      await seedCompetition(`Cup 1000 ${runId}`);
      await seedCompetition(`Cup axb ${runId}`);

      expect((await repository.listAdminCompetitions(`100% ${runId}`)).map((row) => row.id)).toEqual([percent]);
      expect((await repository.listAdminCompetitions(`a_b ${runId}`)).map((row) => row.id)).toEqual([underscore]);
    });

    it("summarises a scope's competitions beyond the latest 10, and only those with a series to come as unfinished", async () => {
      const empty = await createScope("Empty summary");
      const summaries = await repository.listScopeCompetitionSummaries();
      expect(summaries.find((row) => row.scopeId === scopeId)).toEqual({
        scopeId,
        competitionCount: 2,
        unfinishedCompetitions: [`Latest Cup 0 ${runId}`],
      });
      expect(summaries.find((row) => row.scopeId === empty.id)).toBeUndefined();
    });
  });
});
