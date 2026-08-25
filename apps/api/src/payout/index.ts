// Default-wired payout service: real repositories + on-chain settle. When on-chain arenas are
// disabled, settleArena short-circuits (arenas have no onchainArenaId), so nothing is loaded/sent.

import { arenaRepository } from "../db/repositories/arena.repository.js";
import { userRepository } from "../db/repositories/user.repository.js";
import { payoutRepository } from "../db/repositories/payout.repository.js";
import { settleArenaPayoutOnchain } from "../onchain/index.js";
import { createPayoutService } from "./service.js";

export const payoutService = createPayoutService({
  findArena: (id) => arenaRepository.findById(id),
  findWallet: async (userId) => (await userRepository.findById(userId))?.walletAddress,
  listPayouts: (arenaId) => payoutRepository.listByArena(arenaId),
  createPayout: (input) => payoutRepository.create(input),
  deletePayout: (id) => payoutRepository.delete(id),
  markSent: (id, txSignature) => payoutRepository.markSent(id, txSignature),
  markFailed: (id) => payoutRepository.markFailed(id),
  settleOnchain: settleArenaPayoutOnchain,
});

export * from "./service.js";
