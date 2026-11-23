import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";

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
});
