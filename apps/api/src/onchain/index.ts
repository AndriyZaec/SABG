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
  databaseArenaId: string,
): Promise<ArenaOnchainRefs | null> {
  if (!onchainConfig.enabled) return null;
  const { provisionArena } = await import("./arena-program.js");
  const { onchainArenaId, escrowAccount } = await provisionArena(entryFeeLamports, databaseArenaId);
  return { onchainArenaId, escrowAccount };
}

export async function verifyPreparedEntryTransaction(
  preparedTxBase64: string,
  signedTxBase64: string,
  walletAddress: string,
): Promise<import("./arena-program.js").PreparedEntryVerification> {
  const { verifyPreparedEntryTransaction: verify } = await import("./arena-program.js");
  return verify(preparedTxBase64, signedTxBase64, walletAddress);
}

export function isOnchainArenaProvisioningEnabled(): boolean {
  return onchainConfig.enabled;
}

export async function isValidSolanaWalletAddress(walletAddress: string): Promise<boolean> {
  const { PublicKey } = await import("@solana/web3.js");
  try {
    new PublicKey(walletAddress);
    return true;
  } catch {
    return false;
  }
}

/** Build an unsigned `buy_entry` tx for the user to sign. Dynamic import keeps Solana off the default path. */
export async function buildEntryTx(onchainArenaId: number, playerAddress: string): Promise<string> {
  const { buildBuyEntryTx } = await import("./arena-program.js");
  return buildBuyEntryTx(onchainArenaId, playerAddress);
}

/** Submit a user-signed `buy_entry` tx + confirm; returns the signature. */
export async function submitEntryTx(signedTxBase64: string): Promise<string> {
  const { submitSignedEntry } = await import("./arena-program.js");
  return submitSignedEntry(signedTxBase64);
}

/** Sign + send `settle_payout` for an arena. Dynamic import keeps Solana off the default path. */
export async function settleArenaPayoutOnchain(
  onchainArenaId: number,
  winnerWallets: string[],
): Promise<string> {
  const { settlePayoutOnchain } = await import("./arena-program.js");
  return settlePayoutOnchain(onchainArenaId, winnerWallets);
}

/** Refuse automatic demo recycling while the previous arena still holds player funds. */
export async function assertArenaRecyclable(onchainArenaId: number): Promise<void> {
  const { assertArenaRecyclable: assertRecyclable } = await import("./arena-program.js");
  await assertRecyclable(onchainArenaId);
}
