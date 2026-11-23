import { and, eq, sql } from "drizzle-orm";
import { PgBoss, fromDrizzle } from "pg-boss";
import { db, withPayoutLock } from "../db/client.js";
import { arenas, payoutAttempts, payoutPlans, payouts } from "../db/schema.js";
import { userRepository } from "../db/repositories/user.repository.js";
import { logger } from "../gateway/logger.js";
import { sleep } from "../shared/sleep.js";
import { cancelArenaOnchain } from "../onchain/index.js";
import { PayoutBlocked, payoutChain } from "./chain.js";
import type { PayoutStep } from "./chain.js";
import { runPayout } from "./worker.js";
import type { PayoutStore } from "./worker.js";

export const PAYOUT_QUEUE = "settle-arena-v2";
export const payoutQueueOptions = {
  policy: "stately", retryLimit: 10, retryDelay: 10, retryBackoff: true,
  expireInSeconds: 1800, heartbeatSeconds: 15,
} as const;
const producer = new PgBoss({ db: fromDrizzle(db, sql), migrate: false, createSchema: false });

const range = (intent: PayoutStep) => intent.step === "pay"
  ? { from: intent.from, count: intent.wallets.length }
  : { from: 0, count: intent.step === "start" ? intent.count : 0 };

export const payoutService = {
  async settleArena(arenaId: string, winners: string[]): Promise<boolean> {
    const winnerIds = [...winners].sort();
    return db.transaction(async (tx) => {
      const [arena] = await tx.update(arenas).set({ status: "finished" })
        .where(and(eq(arenas.id, arenaId), eq(arenas.status, "live")))
        .returning({ onchainId: arenas.onchainArenaId });
      if (!arena) return false;
      if (arena.onchainId == null || winnerIds.length === 0) return true;
      const onchainArenaId = arena.onchainId;
      const [created] = await tx.insert(payoutPlans).values({ arenaId, onchainArenaId, winnerIds })
        .onConflictDoNothing({ target: payoutPlans.arenaId }).returning({ arenaId: payoutPlans.arenaId });
      if (!created) {
        const [existing] = await tx.select().from(payoutPlans).where(eq(payoutPlans.arenaId, arenaId));
        if (!existing || existing.onchainArenaId !== onchainArenaId || JSON.stringify(existing.winnerIds) !== JSON.stringify(winnerIds)) {
          throw new Error(`Finalized winner set changed for arena ${arenaId}`);
        }
        return true;
      }
      const job = await producer.send(PAYOUT_QUEUE, { arenaId }, { singletonKey: arenaId, db: fromDrizzle(tx, sql) });
      if (!job) throw new Error(`Could not enqueue new payout for ${arenaId}`);
      return true;
    });
  },
};

function createStore(arenaId: string): PayoutStore {
  return {
    wallet: async (id) => (await userRepository.findById(id))?.walletAddress,
    async freeze(recipients) {
      await db.transaction(async (tx) => {
        const [legacy] = await tx.select({ id: payouts.id }).from(payouts).where(eq(payouts.arenaId, arenaId)).limit(1);
        if (legacy) throw new PayoutBlocked("Arena has legacy payout records; reconcile separately");
        await tx.update(payoutPlans).set({ recipients, state: "paying" })
          .where(eq(payoutPlans.arenaId, arenaId));
      });
    },
    async saveShare(share) {
      await db.update(payoutPlans).set({ shareLamports: share.toString() }).where(eq(payoutPlans.arenaId, arenaId));
    },
    attempts: (intent) => db.select().from(payoutAttempts).where(and(eq(payoutAttempts.arenaId, arenaId),
      eq(payoutAttempts.step, intent.step), eq(payoutAttempts.from, range(intent).from))),
    async save(intent, attempt) {
      await db.insert(payoutAttempts).values({ arenaId, step: intent.step, ...range(intent), ...attempt }).onConflictDoNothing();
    },
    async paid(from, recipients, share, signature) {
      const amountLamports = Number(share);
      if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) throw new PayoutBlocked("Unsafe payout amount for DB projection");
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(payoutPlans).set({ paidCount: from + recipients.length })
          .where(and(eq(payoutPlans.arenaId, arenaId), eq(payoutPlans.paidCount, from))).returning();
        if (!updated) throw new Error(`Persisted payout cursor changed for ${arenaId}`);
        await tx.insert(payouts).values(recipients.map((recipient) => ({
          arenaId, userId: recipient.userId, amountLamports, txSignature: signature,
          status: recipient.status, failureReason: recipient.status === "failed" ? recipient.reason : null,
        })));
      });
      for (const [index, recipient] of recipients.entries()) {
        if (recipient.status !== "failed") continue;
        logger.error({ arenaId, index: from + index, signature, userId: recipient.userId, wallet: recipient.wallet,
          amountLamports, reason: recipient.reason }, "Winner payout skipped on-chain");
      }
    },
    async done() {
      await db.update(payoutPlans).set({ state: "done" }).where(eq(payoutPlans.arenaId, arenaId));
    },
    async block(reason) {
      await db.update(payoutPlans).set({ state: "blocked", issue: reason }).where(eq(payoutPlans.arenaId, arenaId));
      logger.error({ arenaId, reason }, "Arena payout blocked");
    },
    wait: () => sleep(1_500),
  };
}

export async function registerPayoutJobs(boss: PgBoss): Promise<void> {
  await boss.work<{ arenaId: string }, void, { includeMetadata: true }>(PAYOUT_QUEUE, { includeMetadata: true }, async ([job]) => {
    if (!job) return;
    const { arenaId } = job.data;
    const store = createStore(arenaId);
    try {
      await withPayoutLock(arenaId, async () => {
        const [plan] = await db.select().from(payoutPlans).where(eq(payoutPlans.arenaId, arenaId));
        if (plan && plan.state !== "done" && plan.state !== "blocked") {
          await runPayout(plan, payoutChain(plan.onchainArenaId), store);
        }
      });
    } catch (error) {
      logger.error({ arenaId, retryCount: job.retryCount, retryLimit: job.retryLimit, err: error }, "Arena payout run failed");
      if (job.retryCount < job.retryLimit) throw error;
      await withPayoutLock(arenaId, async () => {
        const [plan] = await db.select({ state: payoutPlans.state }).from(payoutPlans).where(eq(payoutPlans.arenaId, arenaId));
        if (plan && plan.state !== "done" && plan.state !== "blocked") await store.block(error instanceof Error ? error.message : String(error));
      });
    }
  });
}

export async function recoverPayout(arenaId: string, action: "retry" | "cancel"): Promise<void> {
  await withPayoutLock(arenaId, async () => {
    const [plan] = await db.select().from(payoutPlans).where(eq(payoutPlans.arenaId, arenaId));
    if (!plan || plan.state === "done") throw new Error("No recoverable payout plan");
    if (action === "cancel") {
      // The program atomically rejects cancellation after any payment, including races with pending attempts.
      await cancelArenaOnchain(plan.onchainArenaId);
    }
    await db.transaction(async (tx) => {
      if (action === "cancel") await tx.update(arenas).set({ status: "cancelled", cancelledReason: "operator_skip" })
        .where(and(eq(arenas.id, arenaId), eq(arenas.status, "finished")));
      await tx.update(payoutPlans).set({ state: plan.recipients ? "paying" : "queued", issue: null })
        .where(eq(payoutPlans.arenaId, arenaId));
      // Null means a job is already queued for this arena.
      await producer.send(PAYOUT_QUEUE, { arenaId }, { singletonKey: arenaId, db: fromDrizzle(tx, sql) });
    });
    logger.info({ arenaId, action }, "Arena payout recovery requested");
  });
}
