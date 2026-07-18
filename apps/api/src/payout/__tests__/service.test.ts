import { describe, expect, it, vi } from "vitest";
import type { Arena, Payout, Uuid } from "@arena/contracts";
import { createPayoutService, type PayoutServiceDeps } from "../service.js";

const arena = (overrides: Partial<Arena> = {}): Arena => ({
  id: "arena-1",
  matchId: "match-1",
  status: "finished",
  activePlayersCount: 0,
  entryFeeLamports: 100,
  prizePoolLamports: 300,
  escrowAccount: "Escrow111",
  onchainArenaId: 42,
  ...overrides,
});

// Real base58 wallets — the payout service only pays winners whose wallet is a valid on-chain pubkey.
const WALLET: Record<string, string> = {
  u1: "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCkP2UJnM",
  u2: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};

// Records created payouts and hands back ids so markSent/markFailed can be asserted.
function makeDeps(over: Partial<PayoutServiceDeps> = {}) {
  const created: { id: Uuid; userId: Uuid; amountLamports: number }[] = [];
  let n = 0;
  const deps: PayoutServiceDeps = {
    findArena: vi.fn().mockResolvedValue(arena()),
    findWallet: vi.fn(async (userId: Uuid) => WALLET[userId]),
    createPayout: vi.fn(async (input) => {
      const p: Payout = { id: `p${++n}`, status: "pending", ...input };
      created.push({ id: p.id, userId: input.userId, amountLamports: input.amountLamports });
      return p;
    }),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    settleOnchain: vi.fn().mockResolvedValue("sig-123"),
    ...over,
  };
  return { deps, created };
}

describe("payout service — settleArena", () => {
  it("splits equally (remainder to first), settles on-chain, marks all sent", async () => {
    const { deps, created } = makeDeps();
    await createPayoutService(deps).settleArena("arena-1", ["u1", "u2"]);

    // 300 / 2 → 150 + 150
    expect(created.map((c) => c.amountLamports)).toEqual([150, 150]);
    expect(deps.settleOnchain).toHaveBeenCalledWith(42, [WALLET.u1, WALLET.u2]);
    expect(deps.markSent).toHaveBeenCalledTimes(2);
    expect(deps.markSent).toHaveBeenCalledWith("p1", "sig-123");
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it("gives the remainder to the first winner", async () => {
    const { deps, created } = makeDeps({ findArena: vi.fn().mockResolvedValue(arena({ prizePoolLamports: 301 })) });
    await createPayoutService(deps).settleArena("arena-1", ["u1", "u2"]);
    expect(created.map((c) => c.amountLamports)).toEqual([151, 150]);
  });

  it("marks all payouts failed when the on-chain settle throws", async () => {
    const { deps } = makeDeps({ settleOnchain: vi.fn().mockRejectedValue(new Error("rpc down")) });
    await createPayoutService(deps).settleArena("arena-1", ["u1", "u2"]);
    expect(deps.markFailed).toHaveBeenCalledTimes(2);
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it("skips arenas that were never provisioned on-chain", async () => {
    const { deps } = makeDeps({ findArena: vi.fn().mockResolvedValue(arena({ onchainArenaId: undefined })) });
    await createPayoutService(deps).settleArena("arena-1", ["u1"]);
    expect(deps.createPayout).not.toHaveBeenCalled();
    expect(deps.settleOnchain).not.toHaveBeenCalled();
  });

  it("no-ops when there are no winners", async () => {
    const { deps } = makeDeps();
    await createPayoutService(deps).settleArena("arena-1", []);
    expect(deps.findArena).not.toHaveBeenCalled();
    expect(deps.settleOnchain).not.toHaveBeenCalled();
  });

  it("skips winners with no wallet but pays the rest", async () => {
    const { deps, created } = makeDeps({
      findWallet: vi.fn(async (userId: Uuid) => (userId === "u2" ? undefined : WALLET[userId])),
    });
    await createPayoutService(deps).settleArena("arena-1", ["u1", "u2"]);
    expect(created).toHaveLength(1);
    expect(deps.settleOnchain).toHaveBeenCalledWith(42, [WALLET.u1]);
  });

  it("skips winners whose wallet isn't a valid on-chain pubkey", async () => {
    const { deps, created } = makeDeps({
      findWallet: vi.fn(async (userId: Uuid) => (userId === "u2" ? "scripted-bot-wallet-2" : WALLET[userId])),
    });
    await createPayoutService(deps).settleArena("arena-1", ["u1", "u2"]);
    expect(created).toHaveLength(1);
    expect(deps.settleOnchain).toHaveBeenCalledWith(42, [WALLET.u1]);
  });
});
