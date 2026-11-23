// Run against a dedicated migrated local DB and a fresh local validator with the Arena .so loaded.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { ARENA_TREASURY_ADDRESS } from "@arena/contracts/onchain";
import { sleep } from "../../shared/sleep.js";

const rpcUrl = new URL(process.env["ARENA_RPC_URL"] ?? "http://127.0.0.1:18999");
const databaseUrl = new URL(process.env["DATABASE_URL"] ?? "invalid:");
assert(["127.0.0.1", "localhost"].includes(rpcUrl.hostname));
assert(["127.0.0.1", "localhost"].includes(databaseUrl.hostname) && databaseUrl.pathname.startsWith("/sabg_payout_localnet_"));

async function runWorker() {
  const { registerPayoutJobs } = await import("../index.js");
  const boss = new PgBoss({ connectionString: databaseUrl.toString(), migrate: false, createSchema: false,
    superviseIntervalSeconds: 2, monitorIntervalSeconds: 2 });
  boss.on("error", (error) => console.error(error));
  await boss.start();
  await registerPayoutJobs(boss);
}

async function waitUntil<T>(label: string, read: () => Promise<T | undefined>, deadlineMs = 75_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const result = await read();
    if (result !== undefined) return result;
    await sleep(120);
  }
  throw new Error(`Timed out: ${label}`);
}

async function rehearse() {
  const keypair = Keypair.generate();
  process.env["ARENA_RPC_URL"] = rpcUrl.toString();
  process.env["ARENA_AUTHORITY_SECRET"] = JSON.stringify([...keypair.secretKey]);
  process.env["ONCHAIN_ARENAS_ENABLED"] = "false"; // Provision explicitly after creating the fixture.
  const { db, closeDatabaseConnection } = await import("../../db/client.js");
  const { arenas, payouts, payoutPlans, payoutAttempts } = await import("../../db/schema.js");
  const { payoutService, PAYOUT_QUEUE } = await import("../index.js");
  const { buildProgram, provisionArena, deriveArenaPdas, deriveSettlement } = await import("../../onchain/arena-program.js");
  const { matchRepository } = await import("../../db/repositories/match.repository.js");
  const { arenaRepository } = await import("../../db/repositories/arena.repository.js");
  const { userRepository } = await import("../../db/repositories/user.repository.js");
  const { program } = buildProgram();
  const connection = program.provider.connection;
  const treasury = new PublicKey(ARENA_TREASURY_ADDRESS);
  const inspectionBoss = new PgBoss({ connectionString: databaseUrl.toString(), migrate: false, createSchema: false, supervise: false, schedule: false });
  const spawnWorker = () => spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "worker"], { stdio: "inherit" });
  let worker: ReturnType<typeof spawnWorker> | undefined;
  async function stopWorker() {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, "exit");
      worker.kill("SIGKILL");
      await exited;
    }
  }

  try {
    await inspectionBoss.start();
    const airdrop = await connection.requestAirdrop(keypair.publicKey, 5_000_000_000);
    await connection.confirmTransaction(airdrop, "confirmed");
    const match = await matchRepository.upsertByTxoddsFixtureId(Date.now() % 1_000_000_000, {
      homeTeam: "Localnet payout", awayTeam: "Restart rehearsal", startTime: new Date(),
    });
    const entry = 1_000_000;
    const fixture = await arenaRepository.upsertForMatch(match.id, { mode: "hardcore", entryFeeLamports: entry, prizePoolLamports: 0 });
    const refs = await provisionArena(entry, fixture.id);
    const { arena: arenaPda, escrow } = deriveArenaPdas(program.programId, new anchor.BN(refs.onchainArenaId));
    assert.equal(escrow.toBase58(), refs.escrowAccount);
    const settlement = deriveSettlement(program.programId, arenaPda);
    const players = Array.from({ length: 26 }, () => Keypair.generate());
    const users = await Promise.all(players.map((p) => userRepository.upsertByWallet(p.publicKey.toBase58(), "player")));
    for (let i = 0; i < players.length; i += 13) {
      await program.provider.sendAndConfirm!(new Transaction().add(...players.slice(i, i + 13).map((p) =>
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: p.publicKey, lamports: 4_000_000 }))));
    }
    await program.provider.sendAndConfirm!(new Transaction().add(SystemProgram.transfer({
      fromPubkey: keypair.publicKey, toPubkey: treasury, lamports: 1_000_000,
    })));
    for (let i = 0; i < players.length; i += 5) {
      const batch = players.slice(i, i + 5);
      const ixs = await Promise.all(batch.map((p) => program.methods.buyEntry()
        .accountsPartial({ arena: arenaPda, player: p.publicKey }).instruction()));
      await program.provider.sendAndConfirm!(new Transaction().add(...ixs), batch, {
        commitment: i + 5 >= players.length ? "finalized" : "confirmed", preflightCommitment: "confirmed",
      });
    }
    await db.update(arenas).set({ status: "live", onchainArenaId: refs.onchainArenaId, escrowAccount: escrow.toBase58() })
      .where(eq(arenas.id, fixture.id));
    const before = await connection.getMultipleAccountsInfo([...players.map((p) => p.publicKey), treasury, keypair.publicKey], "finalized");
    const attempts = () => db.select().from(payoutAttempts).where(eq(payoutAttempts.arenaId, fixture.id));
    const plan = async () => (await db.select().from(payoutPlans).where(eq(payoutPlans.arenaId, fixture.id)))[0];
    const started = Date.now();
    assert.equal(await payoutService.settleArena(fixture.id, users.map((u) => u.id)), true);
    worker = spawnWorker();
    const first = await waitUntil("first pay attempt persisted", async () => (await attempts()).find((a) => a.step === "pay"));

    // Prevent the first DB update so the kill is after the chain transfer but before reconciliation.
    await db.transaction(async (tx) => {
      await tx.select().from(payoutPlans).where(eq(payoutPlans.arenaId, fixture.id)).for("update");
      const landed = await waitUntil("first batch finalized", async () =>
        (await connection.getTransaction(first.signature, { commitment: "finalized" })) ?? undefined);
      assert.equal(landed.meta?.err, null);
      assert.equal((await program.account.settlement.fetch(settlement, "finalized")).paidCount, 20);
      assert.equal((await plan())?.paidCount, 0);
      await stopWorker();
    });
    const killed = Date.now();
    console.log("First batch finalized; killed worker with on-chain cursor 20 / DB cursor 0");
    worker = spawnWorker();
    const completed = await waitUntil("restarted worker completed payout", async () => {
      const row = await plan();
      if (row?.state === "blocked") throw new Error(`Payout blocked: ${row.issue}`);
      return row?.state === "done" ? row : undefined;
    }, 115_000);
    assert.equal(completed.paidCount, 26);
    const rows = await db.select().from(payouts).where(eq(payouts.arenaId, fixture.id));
    assert.equal(rows.length, 26);
    assert.equal(new Set(rows.map((r) => r.userId)).size, 26);
    assert.equal(rows.filter((r) => r.txSignature === first.signature).length, 20);
    assert(rows.every((r) => r.status === "sent" && r.amountLamports === 900_000));
    assert.equal((await connection.getBalance(escrow, "finalized")), 0);
    assert.equal(await connection.getAccountInfo(settlement, "finalized"), null);
    const after = await connection.getMultipleAccountsInfo([...players.map((p) => p.publicKey), treasury, keypair.publicKey], "finalized");
    const delta = (index: number) => (after[index]?.lamports ?? 0) - (before[index]?.lamports ?? 0);
    assert(players.every((_, index) => delta(index) === 900_000));
    assert.equal(delta(26), 2_600_000);
    const all = await attempts();
    assert.equal(all.length, 4);
    const receipts = await Promise.all(all.map((r) => connection.getTransaction(r.signature, { commitment: "finalized" })));
    assert(receipts.every((r) => r?.meta?.err === null));
    const fees = receipts.reduce((sum, r) => sum + (r?.meta?.fee ?? 0), 0);
    assert.equal(delta(27), -fees);
    const job = (await inspectionBoss.findJobs(PAYOUT_QUEUE, { data: { arenaId: fixture.id } }))[0];
    assert.equal(job?.retryCount, 1);
    console.log(JSON.stringify({ arenaId: fixture.id, firstBatchMs: killed - started, totalMs: Date.now() - started,
      resumeMs: Date.now() - killed, feesLamports: fees, treasuryLamports: delta(26), rentRecovered: await connection.getMinimumBalanceForRentExemption(121) }));
  } finally {
    await stopWorker();
    await inspectionBoss.stop({ graceful: false });
    await closeDatabaseConnection();
  }
}

await (process.argv[2] === "worker" ? runWorker() : rehearse());
