import { PublicKey } from "@solana/web3.js";
import { PAYOUT_BATCH_SIZE, PayoutBlocked } from "./chain.js";
import type { PayoutChain, PayoutStep, SignedAttempt } from "./chain.js";

export type Recipient = { userId: string; wallet: string };
export type Plan = { arenaId: string; winnerIds: string[]; recipients: Recipient[] | null;
  shareLamports: string | null; paidCount: number; state: "queued" | "paying" | "blocked" | "done" };
export interface PayoutStore {
  wallet(userId: string): Promise<string | undefined>;
  freeze(recipients: Recipient[], share: bigint): Promise<void>;
  attempts(intent: PayoutStep): Promise<SignedAttempt[]>;
  save(intent: PayoutStep, attempt: SignedAttempt): Promise<void>;
  paid(from: number, recipients: Recipient[], share: bigint, signature: string): Promise<void>;
  done(): Promise<void>;
  block(reason: string): Promise<void>;
  wait(): Promise<void>;
}

async function resolveRecipients(ids: string[], store: PayoutStore): Promise<Recipient[]> {
  const unique = new Set<string>();
  const ordered = [];
  for (const userId of ids) {
    const wallet = await store.wallet(userId);
    let key: PublicKey;
    try {
      if (!wallet) throw new Error();
      key = new PublicKey(wallet);
    } catch {
      throw new PayoutBlocked(`Missing or invalid wallet for ${userId}`);
    }
    const canonical = key.toBase58();
    if (unique.has(canonical)) throw new PayoutBlocked(`Duplicate payout wallet: ${canonical}`);
    unique.add(canonical);
    ordered.push({ userId, wallet: canonical, key: key.toBuffer() });
  }
  return ordered.sort((a, b) => Buffer.compare(a.key, b.key)).map(({ userId, wallet }) => ({ userId, wallet }));
}

export async function runPayout(plan: Plan, chain: PayoutChain, store: PayoutStore): Promise<void> {
  if (plan.state === "done" || plan.state === "blocked") return;
  // Allow periodic rebroadcast, but yield to the queue rather than polling forever.
  const confirm = async (intent: PayoutStep, requirePrior: boolean): Promise<string> => {
    let open: SignedAttempt | undefined;
    let missingEvidence = false;
    for (const attempt of await store.attempts(intent)) {
      const state = await chain.status(attempt, intent);
      if (state === "verified") return attempt.signature;
      if (state === "pending") open = attempt;
      if (state === "expired") missingEvidence = true;
    }
    if (requirePrior) {
      if (open || missingEvidence) throw new Error(`Waiting for finalized ${intent.step} transaction evidence`);
      throw new PayoutBlocked(`Cannot verify previously executed ${intent.step} against the plan`);
    }
    if (!open) {
      open = await chain.prepare(intent);
      await store.save(intent, open);
    }
    for (let i = 0; i < 12; i++) {
      if (i % 4 === 0) await chain.broadcast(open);
      await store.wait();
      const state = await chain.status(open, intent);
      if (state === "verified") return open.signature;
      if (state === "failed" || state === "expired") throw new Error(`Payout ${intent.step} attempt ${state}`);
    }
    throw new Error(`Payout ${intent.step} still pending`);
  };

  try {
    const first = await chain.read();
    if (first.state === "cancelled") {
      if (plan.paidCount !== 0 || (first.settlement?.paidCount ?? 0) !== 0) throw new PayoutBlocked("Cancelled payout has paid winners");
      if (first.settlement) await confirm({ step: "close" }, false);
      await store.block("Arena cancelled");
      return;
    }
    const count = plan.winnerIds.length;
    if (count === 0 || count > first.playerCount) throw new PayoutBlocked("Invalid payout winner count");
    let recipients = plan.recipients;
    let share = plan.shareLamports === null ? null : BigInt(plan.shareLamports);
    if (!recipients || share === null) {
      if (first.state !== "open" || first.settlement) throw new PayoutBlocked("No persisted plan for on-chain settlement; reconcile separately");
      recipients = await resolveRecipients(plan.winnerIds, store);
      share = (first.pool - first.pool * BigInt(first.feeBps) / 10_000n) / BigInt(count);
      if (share <= 0n || share > BigInt(Number.MAX_SAFE_INTEGER)) throw new PayoutBlocked("Payout share is outside the supported range");
      await store.freeze(recipients, share);
    }
    if (recipients.length !== count) throw new PayoutBlocked("Persisted payout recipient count mismatch");
    const start: PayoutStep = { step: "start", count };
    if (first.state === "open") {
      const expected = (first.pool - first.pool * BigInt(first.feeBps) / 10_000n) / BigInt(count);
      if (share !== expected) throw new PayoutBlocked("On-chain pool changed after plan was frozen");
      await chain.preflight(recipients.map((r) => r.wallet), share, first.pool);
      await confirm(start, false);
    } else {
      await confirm(start, true);
    }

    let paid = plan.paidCount;
    for (;;) {
      const snapshot = await chain.read();
      if (snapshot.state === "cancelled" && paid === 0 && (snapshot.settlement?.paidCount ?? 0) === 0) {
        if (snapshot.settlement) await confirm({ step: "close" }, false);
        await store.block("Arena cancelled");
        return;
      }
      if (!snapshot.settlement) {
        if (snapshot.state !== "settled" || paid !== count) throw new PayoutBlocked("Settlement missing before reconciliation");
        await confirm({ step: "close" }, true);
        await store.done();
        return;
      }
      const s = snapshot.settlement;
      if (s.paidCount < paid) throw new Error("Finalized RPC cursor is behind persisted payouts");
      if ((snapshot.state !== "settling" && snapshot.state !== "settled") || s.winnerCount !== count || s.share !== share ||
        s.paidCount > count || (s.paidCount > 0 && s.lastPaidKey !== recipients[s.paidCount - 1]?.wallet) ||
        (snapshot.state === "settled") !== (s.paidCount === count)) throw new PayoutBlocked("Finalized settlement does not match payout plan");
      if (paid === count) {
        await confirm({ step: "close" }, false);
        await store.done();
        return;
      }
      if (paid === 0 && s.paidCount === 0) await chain.preflight(recipients.map((r) => r.wallet), share, snapshot.pool);
      const batch = recipients.slice(paid, paid + PAYOUT_BATCH_SIZE);
      if (s.paidCount > paid && s.paidCount < paid + batch.length) throw new PayoutBlocked("Unexpected on-chain batch boundary");
      const signature = await confirm({ step: "pay", from: paid, wallets: batch.map((r) => r.wallet) }, s.paidCount > paid);
      await store.paid(paid, batch, share, signature);
      paid += batch.length;
    }
  } catch (err) {
    if (!(err instanceof PayoutBlocked)) throw err;
    await store.block(err.message);
  }
}
