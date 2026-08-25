import { randomInt, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!RUN)("repositories + write-through PG stores (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../client.js")["db"];
  let schema: typeof import("../schema.js");
  let userRepository: typeof import("../repositories/user.repository.js")["userRepository"];
  let matchRepository: typeof import("../repositories/match.repository.js")["matchRepository"];
  let arenaRepository: typeof import("../repositories/arena.repository.js")["arenaRepository"];
  let arenaPlayerRepository: typeof import("../repositories/arena-player.repository.js")["arenaPlayerRepository"];
  let predictionRoundRepository: typeof import("../repositories/prediction-round.repository.js")["predictionRoundRepository"];
  let predictionRepository: typeof import("../repositories/prediction.repository.js")["predictionRepository"];
  let entryPassRepository: typeof import("../repositories/entry-pass.repository.js")["entryPassRepository"];
  let WriteQueue: typeof import("../../gateway/stores/write-queue.js")["WriteQueue"];
  let createPgPredictionStore: typeof import("../../gateway/stores/pg-prediction-store.js")["createPgPredictionStore"];
  let createPgArenaPlayerStore: typeof import("../../gateway/stores/pg-arena-player-store.js")["createPgArenaPlayerStore"];
  let tryAcquireFixtureRuntimeLock: typeof import("../client.js")["tryAcquireFixtureRuntimeLock"];
  let tryAcquireSeriesRuntimeLock: typeof import("../client.js")["tryAcquireSeriesRuntimeLock"];
  let resetReplayFixture: typeof import("../replay-reset.js")["resetReplayFixture"];

  const runId = randomUUID();
  const walletAddress = `int-test-wallet-${runId}`;
  const homeTeam = `IntTestHome-${runId}`;
  const awayTeam = `IntTestAway-${runId}`;
  const fixtureId = randomInt(1_000_000_000, 2_000_000_000);
  const startTime = new Date();

  let userId: string;
  let matchId: string;
  let arenaId: string;
  let roundId: string;

  beforeAll(async () => {
    ({ db, tryAcquireFixtureRuntimeLock, tryAcquireSeriesRuntimeLock } = await import("../client.js"));
    ({ resetReplayFixture } = await import("../replay-reset.js"));
    schema = await import("../schema.js");
    ({ userRepository } = await import("../repositories/user.repository.js"));
    ({ matchRepository } = await import("../repositories/match.repository.js"));
    ({ arenaRepository } = await import("../repositories/arena.repository.js"));
    ({ arenaPlayerRepository } = await import("../repositories/arena-player.repository.js"));
    ({ predictionRoundRepository } = await import("../repositories/prediction-round.repository.js"));
    ({ predictionRepository } = await import("../repositories/prediction.repository.js"));
    ({ entryPassRepository } = await import("../repositories/entry-pass.repository.js"));
    ({ WriteQueue } = await import("../../gateway/stores/write-queue.js"));
    ({ createPgPredictionStore } = await import("../../gateway/stores/pg-prediction-store.js"));
    ({ createPgArenaPlayerStore } = await import("../../gateway/stores/pg-arena-player-store.js"));
  });

  afterAll(async () => {
    if (db === undefined) return;
    if (roundId) await db.delete(schema.predictions).where(eq(schema.predictions.roundId, roundId));
    if (roundId) await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.id, roundId));
    if (arenaId) await db.delete(schema.arenaPlayers).where(eq(schema.arenaPlayers.arenaId, arenaId));
    if (arenaId) await db.delete(schema.entryPasses).where(eq(schema.entryPasses.arenaId, arenaId));
    if (arenaId) await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    if (matchId) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    await db.delete(schema.replayResetAudits).where(eq(schema.replayResetAudits.fixtureId, fixtureId));
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("user.repository: upsertByWallet creates then keeps the username on repeat sign-in", async () => {
    const first = await userRepository.upsertByWallet(walletAddress, "first-username");
    userId = first.id;
    expect(first.walletAddress).toBe(walletAddress);
    expect(first.username).toBe("first-username");

    const second = await userRepository.upsertByWallet(walletAddress, "second-username");
    expect(second.id).toBe(first.id);
    expect(second.username).toBe("first-username");

    const found = await userRepository.findById(userId);
    expect(found?.walletAddress).toBe(walletAddress);
  });

  it("match.repository: upsertByTxoddsFixtureId is idempotent, and updateLive mirrors live snapshots", async () => {
    const first = await matchRepository.upsertByTxoddsFixtureId(fixtureId, { homeTeam, awayTeam, startTime });
    matchId = first.id;
    const second = await matchRepository.upsertByTxoddsFixtureId(fixtureId, { homeTeam, awayTeam, startTime });
    expect(second.id).toBe(first.id);

    await matchRepository.updateLive(matchId, {
      currentMinute: 42,
      period: "second_half",
      score: { home: 2, away: 1 },
    });
    const updated = await matchRepository.findById(matchId);
    expect(updated).toMatchObject({ currentMinute: 42, period: "second_half", score: { home: 2, away: 1 } });

    const list = await matchRepository.list();
    expect(list.some((m) => m.id === matchId)).toBe(true);
  });

  it("arena.repository: upsertForMatch is idempotent, and bumpActivePlayers/bumpPrizePool increment atomically", async () => {
    const first = await arenaRepository.upsertForMatch(matchId, { entryFeeLamports: 1000, prizePoolLamports: 0 });
    arenaId = first.id;
    expect(first.status).toBe("lobby");

    const second = await arenaRepository.upsertForMatch(matchId, { entryFeeLamports: 1000, prizePoolLamports: 0 });
    expect(second.id).toBe(first.id);

    await arenaRepository.bumpActivePlayers(arenaId, 1);
    await arenaRepository.bumpActivePlayers(arenaId, 1);
    await arenaRepository.bumpPrizePool(arenaId, 1000);
    await arenaRepository.bumpPrizePool(arenaId, 1000);
    const afterBumps = await arenaRepository.findById(arenaId);
    expect(afterBumps?.activePlayersCount).toBe(2);
    expect(afterBumps?.prizePoolLamports).toBe(2000);

    await arenaRepository.setStatus(arenaId, "live");
    const afterStatus = await arenaRepository.findById(arenaId);
    expect(afterStatus?.status).toBe("live");
  });

  it("entry-pass.repository: create persists a paid entry pass", async () => {
    const entryPass = await entryPassRepository.create({
      arenaId,
      userId,
      walletAddress,
      amountLamports: 1000,
      txSignature: "int-test-sig",
    });
    expect(entryPass).toMatchObject({ arenaId, userId, walletAddress, status: "paid" });
  });

  it("arena-player.repository: join is idempotent, getActivePlayerIds/setStatus round-trip", async () => {
    const first = await arenaPlayerRepository.join(arenaId, userId);
    const second = await arenaPlayerRepository.join(arenaId, userId);
    expect(second.id).toBe(first.id);

    const active = await arenaPlayerRepository.getActivePlayerIds(arenaId);
    expect(active).toContain(userId);

    await arenaPlayerRepository.setStatus(arenaId, userId, "eliminated");
    const afterElimination = await arenaPlayerRepository.getActivePlayerIds(arenaId);
    expect(afterElimination).not.toContain(userId);

    const roster = await arenaPlayerRepository.list(arenaId);
    expect(roster.find((p) => p.userId === userId)?.status).toBe("eliminated");

    await arenaPlayerRepository.setStatus(arenaId, userId, "active");
  });

  it("prediction-round.repository: upsert creates on open, then updates the same row on lock/settle", async () => {
    const round = {
      id: randomUUID(),
      arenaId,
      matchId,
      discipline: "soccer" as const,
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot between 20:00 and 25:00?",
      targetEventType: "shot" as const,
      targetTeam: "any" as const,
      settlementCondition: {
        discipline: "soccer" as const,
        targetEventType: "shot" as const,
        targetTeam: "any" as const,
        windowStartMinute: 20,
        windowEndMinute: 25,
        resolve: "event_in_window" as const,
      },
      status: "open" as const,
      openedAt: new Date().toISOString(),
    };
    roundId = round.id;

    const created = await predictionRoundRepository.upsert(round);
    expect(created.status).toBe("open");

    const settled = await predictionRoundRepository.upsert({
      ...round,
      status: "settled",
      correctAnswer: "yes",
      lockedAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      settledBy: "early",
    });
    expect(settled).toMatchObject({ status: "settled", correctAnswer: "yes", settledBy: "early" });

    const found = await predictionRoundRepository.findById(roundId);
    expect(found?.status).toBe("settled");

    const list = await predictionRoundRepository.listByArenaId(arenaId);
    expect(list.map((r) => r.id)).toContain(roundId);
  });

  it("prediction.repository: submitAnswer upserts per (roundId,userId), getAnswers/recordResult/listByRoundId round-trip", async () => {
    await predictionRepository.submitAnswer(roundId, userId, "yes", new Date());
    let answers = await predictionRepository.getAnswers(roundId);
    expect(answers.get(userId)).toBe("yes");

    await predictionRepository.submitAnswer(roundId, userId, "no", new Date());
    answers = await predictionRepository.getAnswers(roundId);
    expect(answers.get(userId)).toBe("no");
    expect(answers.size).toBe(1);

    await predictionRepository.recordResult(roundId, userId, "incorrect");

    const full = await predictionRepository.listByRoundId(roundId);
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ roundId, userId, answer: "no", result: "incorrect" });
  });

  it("pg-prediction-store: write-through cache reads sync, mirrors to Postgres via the write queue", async () => {
    const writeQueue = new WriteQueue();
    const store = createPgPredictionStore(arenaId, writeQueue);

    const receivedAt = new Date();
    store.recordAnswer(roundId, userId, "yes", receivedAt);
    expect(store.getAnswers(roundId).get(userId)).toBe("yes");

    // Await the queued write rather than relying on wall-clock timing.
    await writeQueue.enqueue(arenaId, async () => {});
    const persisted = await predictionRepository.getAnswers(roundId);
    expect(persisted.get(userId)).toBe("yes");
  });

  it("pg-arena-player-store: write-through cache reads sync, mirrors setStatus to Postgres via the write queue", async () => {
    const writeQueue = new WriteQueue();
    const store = createPgArenaPlayerStore(arenaId, writeQueue);
    store.hydrate([{ userId, status: "active" }]);

    store.setStatus(userId, "eliminated");
    expect(store.getStatus(userId)).toBe("eliminated");
    expect(store.getActivePlayerIds(arenaId)).not.toContain(userId);

    await writeQueue.enqueue(arenaId, async () => {});
    const roster = await arenaPlayerRepository.list(arenaId);
    expect(roster.find((p) => p.userId === userId)?.status).toBe("eliminated");
  });

  it("tryAcquireSeriesRuntimeLock excludes a second acquire for the same gridSeriesId, releases cleanly", async () => {
    const gridSeriesId = `int-test-series-${randomUUID()}`;
    const release = await tryAcquireSeriesRuntimeLock(gridSeriesId);
    expect(release).toBeDefined();
    expect(await tryAcquireSeriesRuntimeLock(gridSeriesId)).toBeUndefined();

    const otherGridSeriesId = `int-test-series-${randomUUID()}`;
    const releaseOther = await tryAcquireSeriesRuntimeLock(otherGridSeriesId);
    expect(releaseOther).toBeDefined();
    await releaseOther?.();

    await release?.();
    const reacquired = await tryAcquireSeriesRuntimeLock(gridSeriesId);
    expect(reacquired).toBeDefined();
    await reacquired?.();
  });

  it("replay reset lock excludes an active runtime, then reset deletes atomically and restart recreates a lobby", async () => {
    await db
      .update(schema.arenas)
      .set({ escrowAccount: "IntTestEscrow" })
      .where(eq(schema.arenas.id, arenaId));
    await db.insert(schema.payouts).values({ arenaId, userId, amountLamports: 1000, status: "pending" });
    await db.insert(schema.liveEvents).values({
      matchId,
      eventType: "shot",
      team: "home",
      matchMinute: 42,
      timestamp: new Date(),
      confirmed: true,
    });

    const releaseGatewayLock = await tryAcquireFixtureRuntimeLock(fixtureId);
    expect(releaseGatewayLock).toBeDefined();
    expect(await tryAcquireFixtureRuntimeLock(fixtureId)).toBeUndefined();
    await expect(resetReplayFixture(fixtureId, "localhost:5433/arena")).rejects.toThrow(
      "gateway runtime is active",
    );
    await releaseGatewayLock?.();

    await db.update(schema.arenas).set({ activePlayersCount: 1 }).where(eq(schema.arenas.id, arenaId));
    await expect(
      resetReplayFixture(fixtureId, "localhost:5433/arena", { requireEmptyOffchain: true }),
    ).rejects.toThrow("active players or on-chain state");
    await db.update(schema.arenas).set({ activePlayersCount: 0 }).where(eq(schema.arenas.id, arenaId));

    const previousArenaId = arenaId;
    const audit = await resetReplayFixture(fixtureId, "localhost:5433/arena");

    expect(audit).toMatchObject({
      fixtureId,
      database: "localhost:5433/arena",
      outcome: "reset",
      arenas: [{ id: previousArenaId, status: "live", onchainArenaId: null, escrowAccount: "IntTestEscrow" }],
    });
    expect(await db.select().from(schema.matches).where(eq(schema.matches.id, matchId))).toHaveLength(0);
    expect(await db.select().from(schema.arenas).where(eq(schema.arenas.id, previousArenaId))).toHaveLength(0);
    expect(await db.select().from(schema.predictionRounds).where(eq(schema.predictionRounds.id, roundId))).toHaveLength(0);
    expect(await db.select().from(schema.predictions).where(eq(schema.predictions.roundId, roundId))).toHaveLength(0);
    expect(await db.select().from(schema.liveEvents).where(eq(schema.liveEvents.matchId, matchId))).toHaveLength(0);
    expect(
      await db.select().from(schema.replayResetAudits).where(eq(schema.replayResetAudits.fixtureId, fixtureId)),
    ).toHaveLength(1);

    const recreatedMatch = await matchRepository.upsertByTxoddsFixtureId(fixtureId, { homeTeam, awayTeam, startTime });
    const recreatedArena = await arenaRepository.upsertForMatch(recreatedMatch.id, {
      entryFeeLamports: 1000,
      prizePoolLamports: 0,
    });
    expect(recreatedArena).toMatchObject({ status: "lobby" });
    expect(recreatedArena.id).not.toBe(previousArenaId);

    matchId = recreatedMatch.id;
    arenaId = recreatedArena.id;
    roundId = "";
  });
});
