// Sign-in nonces: issued by POST /auth/nonce, consumed once by POST /auth/wallet. In-memory
// (single-instance dev scope) — mirrors gateway/stores/in-memory-stores.ts. A shared store
// (Redis) would slot in behind this same issue/consume interface if the gateway scales out.

import { buildSignInMessage, generateNonce } from "@arena/auth";
import type { WalletNonceResponse } from "@arena/contracts";

const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_NONCES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

const nonces = new Map<string, { message: string; expiresAt: number }>();

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [walletAddress, entry] of nonces) {
    if (entry.expiresAt <= now) nonces.delete(walletAddress);
  }
}

// Clean up even when no further requests arrive, without keeping the process alive.
setInterval(pruneExpiredNonces, CLEANUP_INTERVAL_MS).unref();

/** Replace this wallet's nonce; refuse new wallets at capacity instead of evicting active nonces. */
export function issueNonce(walletAddress: string, domain: string): WalletNonceResponse | undefined {
  if (!nonces.has(walletAddress) && nonces.size >= MAX_NONCES) {
    pruneExpiredNonces();
    if (nonces.size >= MAX_NONCES) return undefined;
  }
  const nonce = generateNonce();
  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;
  const expirationTime = new Date(expiresAt).toISOString();
  const message = buildSignInMessage({
    domain,
    address: walletAddress,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime,
  });
  nonces.set(walletAddress, { message, expiresAt });
  return { nonce, message, expiresAt: expirationTime };
}

/**
 * Consume only the exact outstanding, unexpired challenge. Failed matches leave it available
 * for a valid retry; expired records are removed and successful messages cannot be replayed.
 */
export function consumeNonce(walletAddress: string, message: string): boolean {
  const entry = nonces.get(walletAddress);
  if (!entry) return false;
  if (Date.now() >= entry.expiresAt) {
    nonces.delete(walletAddress);
    return false;
  }
  if (message !== entry.message) return false;
  nonces.delete(walletAddress);
  return true;
}
