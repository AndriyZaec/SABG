// Payout service — the bridge from a finalized leaderboard to the on-chain escrow release.
// On arena finish it resolves winner wallets, records Payout rows, signs `settle_payout` as the
// payout authority, and marks each row sent/failed. Dependencies are injected so the flow is
// unit-testable without a chain or a database.

import type { Arena, Payout, Uuid, WalletAddress } from "@arena/contracts";

// Only real on-chain wallets can receive an escrow release. A Solana address is base58 (32–44 chars).
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function isPayableWallet(wallet: string): boolean {
  return BASE58_PUBKEY.test(wallet);
}

export interface PayoutServiceDeps {
  findArena: (arenaId: Uuid) => Promise<Arena | undefined>;
  findWallet: (userId: Uuid) => Promise<WalletAddress | undefined>;
  createPayout: (input: { arenaId: Uuid; userId: Uuid; amountLamports: number }) => Promise<Payout>;
  markSent: (payoutId: Uuid, txSignature: string) => Promise<void>;
  markFailed: (payoutId: Uuid) => Promise<void>;
  settleOnchain: (onchainArenaId: number, winnerWallets: WalletAddress[]) => Promise<string>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface PayoutService {
  settleArena: (arenaId: Uuid, winners: Uuid[]) => Promise<void>;
}

export function createPayoutService(deps: PayoutServiceDeps): PayoutService {
  const log = deps.log ?? (() => {});

  return {
    async settleArena(arenaId, winners) {
      if (winners.length === 0) {
        log("payout.skip", { arenaId, reason: "no winners" });
        return;
      }

      const arena = await deps.findArena(arenaId);
      if (!arena || arena.onchainArenaId == null) {
        // Off-chain arena (never provisioned) — nothing to release on-chain.
        log("payout.skip", { arenaId, reason: "arena not on-chain" });
        return;
      }

      // Resolve each winner's wallet; a winner without a wallet can't be paid on-chain.
      const resolved: { userId: Uuid; wallet: WalletAddress }[] = [];
      for (const userId of winners) {
        const wallet = await deps.findWallet(userId);
        if (!wallet) {
          log("payout.skip", { arenaId, userId, reason: "no wallet" });
          continue;
        }
        if (!isPayableWallet(wallet)) {
          log("payout.skip", { arenaId, userId, reason: "wallet not on-chain payable" });
          continue;
        }
        resolved.push({ userId, wallet });
      }
      if (resolved.length === 0) {
        log("payout.skip", { arenaId, reason: "no resolvable winners" });
        return;
      }

      // Equal split, matching the program's on-chain division (remainder → first winner).
      const share = Math.floor(arena.prizePoolLamports / resolved.length);
      const remainder = arena.prizePoolLamports - share * resolved.length;

      const payoutIds: Uuid[] = [];
      for (const [i, w] of resolved.entries()) {
        const amountLamports = i === 0 ? share + remainder : share;
        const payout = await deps.createPayout({ arenaId, userId: w.userId, amountLamports });
        payoutIds.push(payout.id);
      }

      try {
        const txSignature = await deps.settleOnchain(
          arena.onchainArenaId,
          resolved.map((w) => w.wallet),
        );
        for (const id of payoutIds) await deps.markSent(id, txSignature);
        log("payout.sent", { arenaId, txSignature, winners: resolved.length });
      } catch (err) {
        for (const id of payoutIds) await deps.markFailed(id);
        log("payout.failed", { arenaId, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
