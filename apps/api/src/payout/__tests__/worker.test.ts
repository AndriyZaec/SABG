import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { PayoutChain, PayoutStep, SettlementSnapshot, SignedAttempt } from "../chain.js";
import { runPayout } from "../worker.js";
import type { Plan, PayoutStore } from "../worker.js";

function fixture(count = 26, skipped: readonly number[] = []) {
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
      const share = (chainState.pool - chainState.pool / 10n) / BigInt(intent.count);
      chainState.settlement = { share, winnerCount: intent.count, paidCount: 0, lastPaidKey: "" };
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
    status: async (attempt) => {
      const entry = intents.get(attempt.signature);
      if (!entry?.verified) return "pending";
      const intent = entry.intent;
      return { kind: "verified", skipped: intent.step === "pay"
        ? skipped.filter((index) => index >= intent.from && index < intent.from + intent.wallets.length) : [] };
    },
  };
  const paid = vi.fn<PayoutStore["paid"]>(async (from, recipients) => {
    if (plan.paidCount !== from) throw new Error("DB cursor mismatch");
    plan.paidCount += recipients.length;
  });
  const store: PayoutStore = {
    wallet: async (id) => keys[winnerIds.indexOf(id)]?.toBase58(),
    freeze: async (recipients) => { plan.recipients = recipients; plan.state = "paying"; },
    saveShare: async (share) => { plan.shareLamports = share.toString(); },
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
  it("recovers from a process failure after the first batch landed, despite an ambiguous RPC result", async () => {
    const env = fixture();
    const send = env.broadcast.getMockImplementation()!;
    env.broadcast.mockImplementationOnce(send).mockImplementationOnce(async (attempt) => {
      await send(attempt);
      throw new Error("transport timeout");
    });
    env.paid.mockRejectedValueOnce(new Error("process stopped before DB commit"));
    await expect(env.run()).rejects.toThrow("process stopped before DB commit");
    expect(env.chainState.settlement?.paidCount).toBe(20);
    expect(env.plan.paidCount).toBe(0);
    env.paid.mockClear();
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

  it("records verified skips as failed and still reconciles the remaining winners", async () => {
    const env = fixture(26, [21]);
    await env.run();
    const rows = env.paid.mock.calls.flatMap(([, outcomes]) => outcomes);
    expect(rows).toHaveLength(26);
    expect(rows[21]).toMatchObject({ status: "failed", reason: expect.stringContaining("manual reimbursement") });
    expect(rows.filter(({ status }) => status === "sent")).toHaveLength(25);
    expect(env.plan).toMatchObject({ state: "done", paidCount: 26 });
  });

  it("uses the finalized on-chain share after an entry lands between freeze and start", async () => {
    const env = fixture();
    const freeze = env.store.freeze;
    env.store.freeze = async (recipients) => {
      await freeze(recipients);
      expect(env.plan.shareLamports).toBeNull();
      env.chainState.pool += 1_000_007n;
      env.chainState.playerCount++;
    };
    await env.run();
    expect(env.plan).toMatchObject({ state: "done", paidCount: 26, shareLamports: "969237" });
    expect(env.chain.preflight).toHaveBeenCalledWith(expect.any(Array), 969237n, 28_000_196n);
    expect(env.paid.mock.calls.map(([, , share]) => share)).toEqual([969237n, 969237n]);
  });

  it("resumes after start finalized before the share was persisted", async () => {
    const env = fixture();
    const saveShare = env.store.saveShare;
    env.store.saveShare = async () => { throw new Error("DB unavailable"); };
    await expect(env.run()).rejects.toThrow("DB unavailable");
    expect(env.plan.shareLamports).toBeNull();
    expect(env.chainState.settlement?.paidCount).toBe(0);
    env.store.saveShare = saveShare;
    await env.run();
    expect(env.plan).toMatchObject({ state: "done", paidCount: 26, shareLamports: "934621" });
    expect(env.prepared.mock.calls.filter(([intent]) => intent.step === "start")).toHaveLength(1);
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
