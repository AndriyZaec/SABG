import { PgBoss } from "pg-boss";

import { databaseUrl } from "../db/client.js";
import { logger } from "../gateway/logger.js";
import { processPendingRefunds } from "../payout/refunds.js";

export type Scheduler = PgBoss;

const REFUND_QUEUE = "refund-cancelled-arenas";

/** `registerJobs` adds a runtime's own jobs, so this module doesn't depend on them. */
export interface SchedulerOptions {
  registerJobs?: (boss: PgBoss) => Promise<void>;
}

// Fails when the pgboss schema is missing or behind: run the migrate step first.
export async function startScheduler(options: SchedulerOptions = {}): Promise<Scheduler> {
  const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, createSchema: false });
  boss.on("error", (err) => logger.error({ err }, "scheduler: pg-boss error"));
  try {
    await boss.start();
    await registerJobs(boss);
    await options.registerJobs?.(boss);
  } catch (err) {
    // start() opens the pool before checking the schema; close it so a failed startup can exit.
    await boss.stop({ graceful: false }).catch(() => undefined);
    throw err;
  }
  logger.info("scheduler: started");
  return boss;
}

export async function stopScheduler(scheduler: Scheduler): Promise<void> {
  await scheduler.stop();
  logger.info("scheduler: stopped");
}

async function registerJobs(boss: PgBoss): Promise<void> {
  // exclusive: a slow run never piles up queued runs behind it; the next minute picks up what's left.
  await boss.createQueue(REFUND_QUEUE, { policy: "exclusive" });
  await boss.schedule(REFUND_QUEUE, "* * * * *");
  await boss.work(REFUND_QUEUE, async () => {
    await processPendingRefunds();
  });
}
