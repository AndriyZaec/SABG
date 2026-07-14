// Sign-in nonces: issued by POST /auth/nonce, consumed once by POST /auth/wallet. In-memory
// (single-instance dev scope) — mirrors gateway/stores/in-memory-stores.ts. A shared store
// (Redis) would slot in behind this same issue/consume interface if the gateway scales out.

import { generateNonce } from "@arena/auth";

const NONCE_TTL_MS = 5 * 60 * 1000;

const nonces = new Map<string, { nonce: string; expiresAt: number }>();

/** Issue (and store) a fresh nonce for a wallet, replacing any previous unused one. */
export function issueNonce(walletAddress: string): string {
  const nonce = generateNonce();
  nonces.set(walletAddress, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
  return nonce;
}

/**
 * One-time check that `message` embeds the wallet's outstanding, unexpired nonce. Always consumes
 * the stored nonce (success or fail) so a nonce can never be replayed.
 */
export function consumeNonce(walletAddress: string, message: string): boolean {
  const entry = nonces.get(walletAddress);
  nonces.delete(walletAddress);
  if (!entry || Date.now() > entry.expiresAt) return false;
  return message.includes(`Nonce: ${entry.nonce}`);
}
