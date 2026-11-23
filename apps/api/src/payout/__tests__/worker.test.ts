import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { PayoutChain, PayoutStep, SettlementSnapshot, SignedAttempt } from "../chain.js";
import { runPayout } from "../worker.js";
import type { Plan, PayoutStore, Recipient } from "../worker.js";

function fixture(count = 26) {
  const keys = Array.from({ length: count }, () => Keypair.generate().publicKey);
  const winnerIds = keys.map((_, i) => `user-${i}`);
  const plan: Plan = { arenaId: "arena", winnerIds, paidCount: 0, recipients: null, shareLamports: null, state: "queued" };
  const chainState: SettlementSnapshot = { state: "open", pool: 27_000_189n, feeBps: 1000, playerCount: 27, settlement: null };
  const intents = new Map<string, { intent: PayoutStep; verified: boolean }>();
  const attempts: { intent: PayoutStep; attempt: SignedAttempt }[] = [];
  const prepared = vi.fn(async (intent: PayoutStep) => {
    const signature = `signature-${intents.size}`;
    intents.set(signature, { intent, verified: false });
    return { signature, raw: signature, lastValidBlockHeight: 100 };
  });
  const broadcast = vi.fn(async (attempt: SignedAttempt) => {
    const entry = intents.get(attempt.signature);
    if (!entry || entry.verified) return;
    const intent = entry.intent;
    if (intent.step === "start") {
      chainState.state = "settling";
      chainState.settlement = { share: BigInt(plan.shareLamports ?? 0), winnerCount: intent.count, paidCount: 0, lastPaidKey: "" };
    } else if (intent.step === "pay") {
      const settlement = chainState.settlement;
      if (!settlement) throw new Error("missing fixture settlement");
      settlement.paidCount += intent.wallets.length;
      settlement.lastPaidKey = intent.wallets.at(-1) ?? "";
      if (settlement.paidCount === count) chainState.state = "settled";
    } else {
      chainState.settlement = null;
    }
    entry.verified = true;
  });
  const chain: PayoutChain = {
    read: async () => structuredClone(chainState),
    preflight: vi.fn(async () => {}),
    prepare: prepared,
    broadcast,
    status: async (attempt) => intents.get(attempt.signature)?.verified ? "verified" : "pending",
  };
  const paid = vi.fn(async (from: number, recipients: Recipient[], _share: bigint, _signature: string) => {
    if (plan.paidCount !== from) throw new Error("DB cursor mismatch");
    plan.paidCount += recipients.length;
  });
  const store: PayoutStore = {
    wallet: async (id) => keys[winnerIds.indexOf(id)]?.toBase58(),
    freeze: async (recipients, share) => { plan.recipients = recipients; plan.shareLamports = share.toString(); plan.state = "paying"; },
    attempts: async (intent) => attempts.filter((a) => JSON.stringify(a.intent) === JSON.stringify(intent)).map((a) => a.attempt),
    save: async (intent, attempt) => { attempts.push({ intent, attempt }); },
    paid,
    done: async () => { plan.state = "done"; },
    block: vi.fn(async () => { plan.state = "blocked"; }),
    wait: async () => {},
  };
  const run = () => runPayout(structuredClone(plan), chain, store);
  return { run, plan, chainState, chain, store, paid, prepared, broadcast, attempts };
}

describe("payout worker", () => {
  it("recovers from an RPC timeout after the first batch landed, and verifies it before marking sent", async () => {
    const env = fixture();
    const send = env.broadcast.getMockImplementation()!;
    env.broadcast.mockImplementationOnce(send).mockImplementationOnce(async (attempt) => {
      await send(attempt);
      throw new Error("transport timeout");
    });
    await expect(env.run()).rejects.toThrow("transport timeout");
    expect(env.chainState.settlement?.paidCount).toBe(20);
    expect(env.paid).not.toHaveBeenCalled();
    await env.run();
    expect(env.plan.state).toBe("done");
    expect(env.plan.shareLamports).toBe("934621");
    expect(env.paid.mock.calls.map(([from, rows, share, signature]) => [from, rows.length, share, signature])).toEqual([
      [0, 20, 934621n, "signature-1"], [20, 6, 934621n, "signature-2"],
    ]);
    expect(env.chainState.settlement).toBeNull();
  });

  it("blocks a cursor advance it cannot tie to verified batch evidence", async () => {
    const env = fixture();
    env.paid.mockRejectedValueOnce(new Error("DB down"));
    await expect(env.run()).rejects.toThrow("DB down");
    env.attempts.splice(1, 1);
    await env.run();
    expect(env.plan.state).toBe("blocked");
    expect(env.store.block).toHaveBeenCalledWith("Cannot verify previously executed pay against the plan");
    expect(env.chainState.settlement?.paidCount).toBe(20);
    expect(env.plan.paidCount).toBe(0);
  });

  it("blocks the whole plan when a winner has no wallet", async () => {
    const env = fixture();
    env.store.wallet = async () => undefined;
    await env.run();
    expect(env.plan.state).toBe("blocked");
    expect(env.prepared).not.toHaveBeenCalled();
  });

  it("does not attribute a legacy settled arena to a new plan", async () => {
    const env = fixture();
    env.chainState.state = "settled";
    await env.run();
    expect(env.plan.state).toBe("blocked");
    expect(env.prepared).not.toHaveBeenCalled();
  });
});
