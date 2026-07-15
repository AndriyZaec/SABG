// DB integration test — the one place the repositories + write-through PG stores are
// exercised against a real Postgres. Gated on DATABASE_URL so the rest of the suite (and CI by
// default) stays DB-free; run locally (or in a DB-enabled job) with DATABASE_URL set.
//
// Important: db/client.ts throws synchronously at import time if DATABASE_URL is unset. Every
// module here that transitively imports it (all repositories, the PG stores) is therefore
// dynamically imported inside beforeAll — which never runs when describe.skipIf skips the suite —
// rather than as static top-level imports, which vitest would still evaluate even when skipped.

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same class of import-order fragility fixed in db/client.ts: this file deliberately avoids any
// top-level import that transitively loads db/client.ts (so it stays importable when skipped),
// which means nothing else guarantees .env has been read by the time `RUN` is evaluated below —
// load it here directly, matching every other config-reading module in this repo.
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

  // Unique per test run so repeated runs never collide on (walletAddress) / (homeTeam,awayTeam,startTime)
  // unique indexes, and so cleanup only ever removes rows this run created.
  const runId = randomUUID();
  const walletAddress = `int-test-wallet-${runId}`;
  const homeTeam = `IntTestHome-${runId}`;
  const awayTeam = `IntTestAway-${runId}`;

  let userId: string;
  let matchId: string;
  let arenaId: string;
  let roundId: string;

  beforeAll(async () => {
    ({ db } = await import("../client.js"));
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
    if (db === undefined) return; // suite was skipped; nothing to clean up
    // Delete in FK-dependency order (children first).
    if (roundId) await db.delete(schema.predictions).where(eq(schema.predictions.roundId, roundId));
    if (roundId) await db.delete(schema.predictionRounds).where(eq(schema.predictionRounds.id, roundId));
    if (arenaId) await db.delete(schema.arenaPlayers).where(eq(schema.arenaPlayers.arenaId, arenaId));
    if (arenaId) await db.delete(schema.entryPasses).where(eq(schema.entryPasses.arenaId, arenaId));
    if (arenaId) await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    if (matchId) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("user.repository: upsertByWallet creates then keeps the username on repeat sign-in", async () => {
    const first = await userRepository.upsertByWallet(walletAddress, "first-username");
    userId = first.id;
    expect(first.walletAddress).toBe(walletAddress);
    expect(first.username).toBe("first-username");

    // Repeat sign-in with a different reported username — only wallet identity is upserted,
    // per user.repository.ts's doc comment; the original username must survive.
    const second = await userRepository.upsertByWallet(walletAddress, "second-username");
    expect(second.id).toBe(first.id);
    expect(second.username).toBe("first-username");

    const found = await userRepository.findById(userId);
    expect(found?.walletAddress).toBe(walletAddress);
  });

  it("match.repository: upsertByTxoddsFixtureId is idempotent, and updateLive mirrors live snapshots", async () => {
    const fixtureId = Number(`9${Date.now()}`.slice(0, 9)); // unique-enough per run
    const startTime = new Date();
    const first = await matchRepository.upsertByTxoddsFixtureId(fixtureId, { homeTeam, awayTeam, startTime });
    matchId = first.id;
    const second = await matchRepository.upsertByTxoddsFixtureId(fixtureId, { homeTeam, awayTeam, startTime });
    expect(second.id).toBe(first.id); // idempotent — no duplicate row

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
    const second = await arenaPlayerRepository.join(arenaId, userId); // idempotent re-join
    expect(second.id).toBe(first.id);

    const active = await arenaPlayerRepository.getActivePlayerIds(arenaId);
    expect(active).toContain(userId);

    await arenaPlayerRepository.setStatus(arenaId, userId, "eliminated");
    const afterElimination = await arenaPlayerRepository.getActivePlayerIds(arenaId);
    expect(afterElimination).not.toContain(userId);

    const roster = await arenaPlayerRepository.list(arenaId);
    expect(roster.find((p) => p.userId === userId)?.status).toBe("eliminated");

    // Restore to active for the write-through store tests below.
    await arenaPlayerRepository.setStatus(arenaId, userId, "active");
  });

  it("prediction-round.repository: upsert creates on open, then updates the same row on lock/settle", async () => {
    const round = {
      id: randomUUID(),
      arenaId,
      matchId,
      windowStartMinute: 20,
      windowEndMinute: 25,
      question: "Will there be a shot between 20:00 and 25:00?",
      targetEventType: "shot" as const,
      targetTeam: "any" as const,
      settlementCondition: {
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

    // Re-answering (spec §5: change before lock) overwrites, not duplicates (unique index).
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
    // Synchronous read reflects the write immediately, before the PG mirror necessarily lands.
    expect(store.getAnswers(roundId).get(userId)).toBe("yes");

    // Wait for the enqueued PG write specifically, rather than an arbitrary sleep.
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
});
