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
  listPayouts: (arenaId: Uuid) => Promise<Payout[]>;
  createPayout: (input: { arenaId: Uuid; userId: Uuid; amountLamports: number }) => Promise<Payout>;
  deletePayout: (payoutId: Uuid) => Promise<void>;
  markSent: (payoutId: Uuid, txSignature?: string) => Promise<void>;
  markFailed: (payoutId: Uuid) => Promise<void>;
  settleOnchain: (
    onchainArenaId: number,
    winnerWallets: WalletAddress[],
  ) => Promise<
    | { status: "submitted"; txSignature: string }
    | { status: "reconciled" }
    | { status: "already-settled" }
  >;
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

      const existingPayouts = await deps.listPayouts(arenaId);
      const expectedUsers = new Set(resolved.map((winner) => winner.userId));
      if (existingPayouts.some((payout) => !expectedUsers.has(payout.userId))) {
        throw new Error(`Existing payouts for arena ${arenaId} do not match the finalized winners`);
      }
      if (new Set(existingPayouts.map((payout) => payout.userId)).size !== existingPayouts.length) {
        throw new Error(`Arena ${arenaId} has duplicate payout rows`);
      }
      const payoutRows: Payout[] = [];
      const createdPayoutRows: Payout[] = [];
      for (const [i, w] of resolved.entries()) {
        const amountLamports = i === 0 ? share + remainder : share;
        const existing = existingPayouts.find((payout) => payout.userId === w.userId);
        if (existing && existing.amountLamports !== amountLamports) {
          throw new Error(`Existing payout ${existing.id} does not match the finalized payout amount`);
        }
        if (existing) {
          payoutRows.push(existing);
        } else {
          const created = await deps.createPayout({ arenaId, userId: w.userId, amountLamports });
          createdPayoutRows.push(created);
          payoutRows.push(created);
        }
      }

      if (payoutRows.every((payout) => payout.status === "sent")) {
        log("payout.skip", { arenaId, reason: "already sent" });
        return;
      }

      let settlement: Awaited<ReturnType<PayoutServiceDeps["settleOnchain"]>>;
      try {
        settlement = await deps.settleOnchain(
          arena.onchainArenaId,
          resolved.map((w) => w.wallet),
        );
      } catch (err) {
        for (const payout of payoutRows) {
          if (payout.status !== "sent") await deps.markFailed(payout.id);
        }
        log("payout.failed", { arenaId, error: err instanceof Error ? err.message : String(err) });
        return;
      }

      if (settlement.status === "already-settled" && createdPayoutRows.length > 0) {
        for (const payout of createdPayoutRows) await deps.deletePayout(payout.id);
        log("payout.failed", { arenaId, error: "settled on-chain without a complete persisted payout plan" });
        return;
      }

      const txSignature = settlement.status === "submitted" ? settlement.txSignature : undefined;
      try {
        for (const payout of payoutRows) await deps.markSent(payout.id, txSignature);
        log("payout.sent", { arenaId, settlement: settlement.status, txSignature, winners: resolved.length });
      } catch (err) {
        log("payout.sync_failed", { arenaId, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
