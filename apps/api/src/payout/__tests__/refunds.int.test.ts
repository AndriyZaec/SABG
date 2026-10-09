import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Arena } from "@arena/contracts";

dotenv.config();

const RUN = Boolean(process.env["DATABASE_URL"]);

const onchainMocks = vi.hoisted(() => ({ refundArenaEntryOnchain: vi.fn() }));
vi.mock("../../onchain/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../onchain/index.js")>()),
  refundArenaEntryOnchain: onchainMocks.refundArenaEntryOnchain,
}));

describe.skipIf(!RUN)("processPendingRefunds (integration, requires DATABASE_URL)", () => {
  let db: typeof import("../../db/client.js")["db"];
  let schema: typeof import("../../db/schema.js");
  let arenaRepository: typeof import("../../db/repositories/arena.repository.js")["arenaRepository"];
  let matchRepository: typeof import("../../db/repositories/match.repository.js")["matchRepository"];
  let entryPassRepository: typeof import("../../db/repositories/entry-pass.repository.js")["entryPassRepository"];
  let userRepository: typeof import("../../db/repositories/user.repository.js")["userRepository"];
  let processPendingRefunds: typeof import("../refunds.js")["processPendingRefunds"];

  const arenaIds: string[] = [];
  const matchIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db/client.js"));
    schema = await import("../../db/schema.js");
    ({ arenaRepository } = await import("../../db/repositories/arena.repository.js"));
    ({ matchRepository } = await import("../../db/repositories/match.repository.js"));
    ({ entryPassRepository } = await import("../../db/repositories/entry-pass.repository.js"));
    ({ userRepository } = await import("../../db/repositories/user.repository.js"));
    ({ processPendingRefunds } = await import("../refunds.js"));
  });

  beforeEach(() => {
    onchainMocks.refundArenaEntryOnchain.mockReset();
    onchainMocks.refundArenaEntryOnchain.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (db === undefined) return;
    for (const arenaId of arenaIds) {
      await db.delete(schema.entryPasses).where(eq(schema.entryPasses.arenaId, arenaId));
      await db.delete(schema.arenas).where(eq(schema.arenas.id, arenaId));
    }
    for (const matchId of matchIds) await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    for (const userId of userIds) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function seedArena(status: Arena["status"], onchainArenaId: number | null, walletCount: number) {
    const match = await matchRepository.upsertByTxoddsFixtureId(Math.floor(Math.random() * 1_000_000_000), {
      homeTeam: `Home ${randomUUID()}`,
      awayTeam: `Away ${randomUUID()}`,
      startTime: new Date(),
    });
    matchIds.push(match.id);
    const arena = await arenaRepository.upsertForMatch(match.id, { entryFeeLamports: 1000, prizePoolLamports: 0 });
    arenaIds.push(arena.id);
    await db
      .update(schema.arenas)
      .set({ status, onchainArenaId, activePlayersCount: walletCount, prizePoolLamports: walletCount * 1000 })
      .where(eq(schema.arenas.id, arena.id));

    const passes = [];
    for (let i = 0; i < walletCount; i++) {
      const wallet = `int-test-wallet-${randomUUID()}`;
      const user = await userRepository.upsertByWallet(wallet, "player");
      userIds.push(user.id);
      passes.push(
        await entryPassRepository.create({
          arenaId: arena.id,
          userId: user.id,
          walletAddress: wallet,
          amountLamports: 1000,
          txSignature: `sig-${randomUUID()}`,
        }),
      );
    }
    return { arenaId: arena.id, passes };
  }

  async function passStatuses(arenaId: string) {
    return (await entryPassRepository.listByArenaId(arenaId)).map((pass) => pass.status);
  }

  // processPendingRefunds scans the shared DB while other files run, so only count calls for our own rows.
  function onchainCallsFor(filter: { onchainArenaId?: number; wallet?: string }) {
    return onchainMocks.refundArenaEntryOnchain.mock.calls.filter(
      ([id, wallet]) =>
        (filter.onchainArenaId === undefined || id === filter.onchainArenaId) &&
        (filter.wallet === undefined || wallet === filter.wallet),
    );
  }

  it("refunds every paid pass of a cancelled arena on-chain and clears its balances", async () => {
    const onchainArenaId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const { arenaId, passes } = await seedArena("cancelled", onchainArenaId, 2);

    await processPendingRefunds();

    expect(await passStatuses(arenaId)).toEqual(["refunded", "refunded"]);
    expect(onchainCallsFor({ onchainArenaId }).map(([, wallet]) => wallet).sort()).toEqual(
      passes.map((pass) => pass.walletAddress).sort(),
    );
    expect(await arenaRepository.findById(arenaId)).toMatchObject({ prizePoolLamports: 0, activePlayersCount: 0 });
  });

  it("leaves lobby and live arenas alone", async () => {
    const lobby = await seedArena("lobby", null, 1);
    const live = await seedArena("live", null, 1);

    await processPendingRefunds();

    expect(await passStatuses(lobby.arenaId)).toEqual(["paid"]);
    expect(await passStatuses(live.arenaId)).toEqual(["paid"]);
    expect(await arenaRepository.findById(live.arenaId)).toMatchObject({ prizePoolLamports: 1000, activePlayersCount: 1 });
  });

  it("refunds the full paid entry when the arena lacks a second player", async () => {
    const { arenaId, passes } = await seedArena("cancelled", null, 1);
    await db.update(schema.arenas).set({ cancelledReason: "insufficient_players" }).where(eq(schema.arenas.id, arenaId));
    await processPendingRefunds();
    expect(await entryPassRepository.listByArenaId(arenaId)).toEqual([
      expect.objectContaining({ id: passes[0]!.id, amountLamports: 1000, status: "refunded" }),
    ]);
    expect(await arenaRepository.findById(arenaId)).toMatchObject({ prizePoolLamports: 0, activePlayersCount: 0 });
  });

  it("keeps a failed wallet paid, skips clearing balances, and finishes on the next run", async () => {
    const onchainArenaId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const { arenaId, passes } = await seedArena("cancelled", onchainArenaId, 2);
    const healthy = await seedArena("cancelled", onchainArenaId + 1, 1);
    const failingWallet = passes[0]!.walletAddress;
    const succeedingWallet = passes[1]!.walletAddress;
    onchainMocks.refundArenaEntryOnchain.mockImplementation(async (_id: number, wallet: string) => {
      if (wallet === failingWallet) throw new Error("rpc unavailable");
    });

    await processPendingRefunds();

    const afterFirst = await entryPassRepository.listByArenaId(arenaId);
    expect(afterFirst.find((pass) => pass.walletAddress === failingWallet)?.status).toBe("paid");
    expect(afterFirst.find((pass) => pass.walletAddress !== failingWallet)?.status).toBe("refunded");
    expect(await arenaRepository.findById(arenaId)).toMatchObject({ prizePoolLamports: 2000, activePlayersCount: 2 });
    // Another arena's failure doesn't hold this one back.
    expect(await passStatuses(healthy.arenaId)).toEqual(["refunded"]);
    expect(await arenaRepository.findById(healthy.arenaId)).toMatchObject({ prizePoolLamports: 0, activePlayersCount: 0 });

    onchainMocks.refundArenaEntryOnchain.mockResolvedValue(undefined);
    await processPendingRefunds();

    expect(await passStatuses(arenaId)).toEqual(["refunded", "refunded"]);
    expect(await arenaRepository.findById(arenaId)).toMatchObject({ prizePoolLamports: 0, activePlayersCount: 0 });
    // A wallet refunded in the first run is never refunded on-chain again.
    expect(onchainCallsFor({ wallet: succeedingWallet })).toHaveLength(1);
  });

  it("refunds an off-chain arena's passes without an on-chain call", async () => {
    const { arenaId, passes } = await seedArena("cancelled", null, 1);

    await processPendingRefunds();

    expect(await passStatuses(arenaId)).toEqual(["refunded"]);
    expect(onchainCallsFor({ wallet: passes[0]!.walletAddress })).toEqual([]);
  });
});
