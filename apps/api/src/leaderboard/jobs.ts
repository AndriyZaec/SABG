import type { PgBoss } from "pg-boss";
import { leaderboardRepository } from "../db/repositories/leaderboard.repository.js";
import { logger } from "../gateway/logger.js";
import { recomputeScope } from "./recompute.js";

const RECOMPUTE_QUEUE = "leaderboard-recompute";
const TRADE_URL_ERASURE_QUEUE = "leaderboard-trade-url-erasure";
/** A winner's trade URL is personal data, kept only this long after the prize is sent. */
const TRADE_URL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Players only see the current scope, so only it is kept fresh; no current scope → nothing to do. */
export async function recomputeCurrentScope(): Promise<void> {
  const scope = await leaderboardRepository.findCurrent();
  if (scope !== undefined) await recomputeScope(scope.id);
}

/** Registers the recompute queue and returns the trigger that queues a run right away. */
export async function registerLeaderboardJobs(boss: PgBoss): Promise<() => void> {
  // stately: one run queued behind an active one, so an arena that finishes mid-run is picked up next.
  await boss.createQueue(RECOMPUTE_QUEUE, { policy: "stately" });
  await boss.schedule(RECOMPUTE_QUEUE, "*/15 * * * *");
  await boss.work(RECOMPUTE_QUEUE, async () => {
    await recomputeCurrentScope();
  });
  return () => {
    void boss.send(RECOMPUTE_QUEUE, {}).catch((err: unknown) => logger.error({ err }, "leaderboard: failed to queue a recompute"));
  };
}

export async function eraseExpiredTradeUrls(now = new Date()): Promise<number> {
  const erased = await leaderboardRepository.eraseSentTradeUrls(new Date(now.getTime() - TRADE_URL_RETENTION_MS));
  logger.info({ erased }, "leaderboard: erased trade URLs of prizes sent over 30 days ago");
  return erased;
}

export async function registerTradeUrlErasureJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(TRADE_URL_ERASURE_QUEUE, { policy: "exclusive" });
  await boss.schedule(TRADE_URL_ERASURE_QUEUE, "17 3 * * *");
  await boss.work(TRADE_URL_ERASURE_QUEUE, async () => {
    await eraseExpiredTradeUrls();
  });
}
