import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

describe.skipIf(!process.env["DATABASE_URL"])("payout queue transaction", () => {
  it("commits one plan and one pg-boss job when arena completion overlaps", async () => {
    const { db, databaseUrl } = await import("../../db/client.js");
    const { arenas, matches, payoutPlans } = await import("../../db/schema.js");
    const { arenaRepository } = await import("../../db/repositories/arena.repository.js");
    const { matchRepository } = await import("../../db/repositories/match.repository.js");
    const { payoutService, PAYOUT_QUEUE } = await import("../index.js");
    const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, createSchema: false, supervise: false, schedule: false });
    const match = await matchRepository.upsertByTxoddsFixtureId(randomInt(1_000_000_000), {
      homeTeam: "Payout home", awayTeam: "Payout away", startTime: new Date(),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, { mode: "hardcore", entryFeeLamports: 1_000_000, prizePoolLamports: 0 });
    try {
      await boss.start();
      await db.update(arenas).set({ status: "live", onchainArenaId: Date.now() }).where(eq(arenas.id, arena.id));
      const winners = [randomUUID(), randomUUID()];
      const outcomes = await Promise.all([payoutService.settleArena(arena.id, winners), payoutService.settleArena(arena.id, winners)]);
      expect(new Set(outcomes)).toEqual(new Set([true, false]));
      const jobs = await boss.findJobs(PAYOUT_QUEUE, { data: { arenaId: arena.id } });
      expect(jobs).toHaveLength(1);
      const [plan] = await db.select().from(payoutPlans).where(eq(payoutPlans.arenaId, arena.id));
      expect(plan?.winnerIds).toEqual(winners.sort());
      expect((await arenaRepository.findById(arena.id))?.status).toBe("finished");
      if (jobs[0]) await boss.deleteJob(PAYOUT_QUEUE, jobs[0].id);
    } finally {
      await boss.stop({ graceful: false });
      await db.delete(arenas).where(eq(arenas.id, arena.id));
      await db.delete(matches).where(eq(matches.id, match.id));
    }
  });

  it("logs failed runs, retries, then blocks the plan when the retry budget is exhausted", async () => {
    const { db, databaseUrl } = await import("../../db/client.js");
    const { arenas, matches, payoutPlans } = await import("../../db/schema.js");
    const { arenaRepository } = await import("../../db/repositories/arena.repository.js");
    const { matchRepository } = await import("../../db/repositories/match.repository.js");
    const { logger } = await import("../../gateway/logger.js");
    const chain = await import("../chain.js");
    const { registerPayoutJobs, PAYOUT_QUEUE } = await import("../index.js");
    const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, createSchema: false, supervise: false, schedule: false });
    const match = await matchRepository.upsertByTxoddsFixtureId(randomInt(1_000_000_000), {
      homeTeam: "Retry home", awayTeam: "Retry away", startTime: new Date(),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, { mode: "hardcore", entryFeeLamports: 1_000_000, prizePoolLamports: 0 });
    const onchainId = Date.now();
    const error = new Error("Payout RPC unavailable");
    const log = vi.spyOn(logger, "error");
    const connect = vi.spyOn(chain, "payoutChain").mockImplementation(() => { throw error; });
    let jobId: string | null = null;
    try {
      await boss.start();
      await db.update(arenas).set({ status: "finished", onchainArenaId: onchainId }).where(eq(arenas.id, arena.id));
      await db.insert(payoutPlans).values({ arenaId: arena.id, onchainArenaId: onchainId, winnerIds: [randomUUID()], state: "paying" });
      jobId = await boss.send(PAYOUT_QUEUE, { arenaId: arena.id }, { singletonKey: arena.id, retryLimit: 1, retryDelay: 0, retryBackoff: false });
      expect(jobId).not.toBeNull();
      await registerPayoutJobs(boss);
      await vi.waitFor(async () => {
        const [plan] = await db.select().from(payoutPlans).where(eq(payoutPlans.arenaId, arena.id));
        expect(plan).toMatchObject({ state: "blocked", issue: error.message });
      }, { timeout: 10_000, interval: 100 });
      expect(connect.mock.calls.filter(([id]) => id === onchainId)).toHaveLength(2);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ arenaId: arena.id, retryCount: 0, err: error }), "Arena payout run failed");
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ arenaId: arena.id, retryCount: 1, err: error }), "Arena payout run failed");
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ arenaId: arena.id, reason: error.message }), "Arena payout blocked");
    } finally {
      if (jobId) await boss.deleteJob(PAYOUT_QUEUE, jobId);
      await boss.stop({ graceful: false });
      connect.mockRestore();
      log.mockRestore();
      await db.delete(arenas).where(eq(arenas.id, arena.id));
      await db.delete(matches).where(eq(matches.id, match.id));
    }
  }, 15_000);
});
