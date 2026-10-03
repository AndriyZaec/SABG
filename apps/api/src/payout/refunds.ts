import type { Uuid } from "@arena/contracts";

import { arenaRepository } from "../db/repositories/arena.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { logger } from "../gateway/logger.js";
import { refundArenaEntryOnchain } from "../onchain/index.js";

// Arenas with paid entries are cancelled only from lobby, so every paid pass gets its full entry back.
export async function processPendingRefunds(): Promise<void> {
  const pending = await entryPassRepository.listPaidInCancelledArenas();
  const failedArenaIds = new Set<Uuid>();

  for (const { pass, onchainArenaId } of pending) {
    try {
      if (onchainArenaId !== undefined) await refundArenaEntryOnchain(onchainArenaId, pass.walletAddress);
      await entryPassRepository.markRefunded(pass.id);
    } catch (err) {
      failedArenaIds.add(pass.arenaId);
      logger.error({ err, arenaId: pass.arenaId, passId: pass.id }, "refunds: entry refund failed, retrying next run");
    }
  }

  const arenaIds = new Set(pending.map(({ pass }) => pass.arenaId));
  for (const arenaId of arenaIds) {
    if (!failedArenaIds.has(arenaId)) await arenaRepository.clearCancelledBalances(arenaId);
  }
  if (pending.length > 0) {
    logger.info({ passes: pending.length, arenas: arenaIds.size, failedArenas: failedArenaIds.size }, "refunds: run complete");
  }
}
