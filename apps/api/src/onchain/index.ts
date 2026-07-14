import { onchainConfig } from "./config.js";

export interface ArenaOnchainRefs {
  onchainArenaId: number;
  escrowAccount: string;
}

/**
 * Provision an on-chain arena when enabled, else null (off-chain demo path). The Solana client
 * and authority key are only loaded in the enabled branch, so the default path pulls in nothing.
 */
export async function maybeProvisionArena(
  entryFeeLamports: number,
): Promise<ArenaOnchainRefs | null> {
  if (!onchainConfig.enabled) return null;
  const { provisionArena } = await import("./arena-program.js");
  const { onchainArenaId, escrowAccount } = await provisionArena(entryFeeLamports);
  return { onchainArenaId, escrowAccount };
}

/** Sign + send `settle_payout` for an arena. Dynamic import keeps Solana off the default path. */
export async function settleArenaPayoutOnchain(
  onchainArenaId: number,
  winnerWallets: string[],
): Promise<string> {
  const { settlePayoutOnchain } = await import("./arena-program.js");
  return settlePayoutOnchain(onchainArenaId, winnerWallets);
}
