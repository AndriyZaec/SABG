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
const entryGates = new Map<Uuid, { closed: boolean; active: number; waiters: Array<() => void> }>();

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

export function beginEntrySubmission(arenaId: Uuid): (() => void) | undefined {
  const gate = entryGates.get(arenaId) ?? { closed: false, active: 0, waiters: [] };
  entryGates.set(arenaId, gate);
  if (gate.closed) return undefined;
  gate.active += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    gate.active -= 1;
    if (gate.active === 0) gate.waiters.splice(0).forEach((resolve) => resolve());
  };
}

/** Stops new irreversible submits and waits for every accepted submit to finish seating. */
export async function closeEntrySubmissions(arenaId: Uuid): Promise<void> {
  const gate = entryGates.get(arenaId) ?? { closed: false, active: 0, waiters: [] };
  entryGates.set(arenaId, gate);
  gate.closed = true;
  if (gate.active === 0) return;
  await new Promise<void>((resolve) => gate.waiters.push(resolve));
}
