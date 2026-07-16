// Short-lived server-side store of prepared (unsigned) entry transactions. `prepare` builds a
// buy_entry tx while the arena is in `lobby` and stashes it here keyed by a random id; `submit`
// looks it up by that id, so the client can only submit a tx the backend built (no tampering) and
// only for a join it started during the lobby. Entries expire with the tx's blockhash.

import { randomUUID } from "node:crypto";
import type { Uuid } from "@arena/contracts";

export interface PendingEntry {
  arenaId: Uuid;
  walletAddress: string;
  /** Base64 unsigned tx handed to the browser to sign. */
  tx: string;
  expiresAt: number;
}

/** ~ a Solana blockhash lifetime; a slow signer past this just re-prepares (no funds moved). */
const TTL_MS = 90_000;

const pending = new Map<string, PendingEntry>();

export function stashPrepare(arenaId: Uuid, walletAddress: string, tx: string): string {
  const prepareId = randomUUID();
  pending.set(prepareId, { arenaId, walletAddress, tx, expiresAt: Date.now() + TTL_MS });
  return prepareId;
}

/** One-shot fetch: removes the entry and returns it, or undefined if unknown/expired. */
export function takePrepare(prepareId: string): PendingEntry | undefined {
  const entry = pending.get(prepareId);
  pending.delete(prepareId);
  if (entry === undefined || Date.now() > entry.expiresAt) return undefined;
  return entry;
}
