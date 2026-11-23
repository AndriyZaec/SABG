import anchor from "@coral-xyz/anchor";
import chai from "chai";
import type { Program, web3 } from "@coral-xyz/anchor";
import type { Arena as ArenaProgram } from "../target/types/arena.js";

const { AnchorProvider, BN, setProvider, workspace } = anchor;
const { PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, SystemProgram, ComputeBudgetProgram } = anchor.web3;
const assert: Chai.AssertStatic = chai.assert;

const envProvider = AnchorProvider.env();
const provider = new AnchorProvider(
  new anchor.web3.Connection(envProvider.connection.rpcEndpoint, "confirmed"),
  envProvider.wallet,
  { commitment: "confirmed", preflightCommitment: "confirmed" },
);
setProvider(provider);

const program = workspace.Arena as Program<ArenaProgram>;
const authority = provider.wallet as anchor.Wallet;
const entryFee = new BN(0.1 * LAMPORTS_PER_SOL);
const platformFeeBps = 1_000;
const treasury = new PublicKey("nvy4VWVymKZpYZEBtwNYUzJzG9R11P7Wc7khvenMpzW");

let nextArenaId = Date.now();
const freshArenaId = () => new BN(nextArenaId++);

const deriveArena = (arenaId: anchor.BN) => {
  const [arena] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), arena.toBuffer()],
    program.programId,
  );
  return { arena, escrow };
};

const entryPassPda = (arena: web3.PublicKey, player: web3.PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), arena.toBuffer(), player.toBuffer()],
    program.programId,
  )[0];

const settlementPda = (arena: web3.PublicKey) => PublicKey.findProgramAddressSync(
  [Buffer.from("settlement"), arena.toBuffer()], program.programId,
)[0];
const sortKeys = (keys: readonly web3.PublicKey[]) => [...keys].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
const writableWinner = (pubkey: web3.PublicKey) => ({ pubkey, isWritable: true, isSigner: false });
const payoutAccounts = (arena: web3.PublicKey, escrow: web3.PublicKey) => ({
  arena, escrow, treasury, payoutAuthority: authority.publicKey,
});
const startSettlement = (arena: web3.PublicKey, escrow: web3.PublicKey, winnerCount: number) =>
  program.methods.startSettlement(winnerCount).accounts(payoutAccounts(arena, escrow));
const payBatch = (arena: web3.PublicKey, escrow: web3.PublicKey, expectedPaid: number, winners: web3.PublicKey[]) =>
  program.methods.payBatch(expectedPaid).accountsPartial(payoutAccounts(arena, escrow)).remainingAccounts(winners.map(writableWinner));
const closeSettlement = (arena: web3.PublicKey) => program.methods.closeSettlement()
  .accountsPartial({ arena, payoutAuthority: authority.publicKey, funder: authority.publicKey });
const finalized = { commitment: "finalized", preflightCommitment: "confirmed" } as const;

const anchorErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { error?: { errorCode?: { code?: string } } }).error?.errorCode?.code;
};

const expectAnchorError = async (operation: () => Promise<unknown>, expectedCode: string) => {
  try {
    await operation();
    assert.fail(`expected Anchor error ${expectedCode}`);
  } catch (error) {
    assert.equal(anchorErrorCode(error), expectedCode);
  }
};

const fundedPlayer = async (): Promise<web3.Keypair> => {
  const kp = Keypair.generate();
  if (process.env["SELF_FUND_TEST_PLAYERS"] === "true") {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: kp.publicKey,
        lamports: 0.12 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(transaction);
    return kp;
  }
  const sig = await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
};

const initArena = async (
  arenaId: anchor.BN,
  arenaEntryFee: anchor.BN = entryFee,
  arenaPlatformFeeBps = platformFeeBps,
  payoutAuthority = authority.publicKey,
) =>
  program.methods
    .initArena(arenaId, arenaEntryFee, payoutAuthority, arenaPlatformFeeBps)
    .accounts({ authority: authority.publicKey })
    .rpc();

const buyIn = async (arena: web3.PublicKey): Promise<web3.Keypair> => {
  const player = await fundedPlayer();
  await program.methods
    .buyEntry()
    .accountsPartial({ arena, player: player.publicKey })
    .signers([player])
    .rpc();
  return player;
};

const fundAndEnter = async (arena: web3.PublicKey, count: number, fee: number) => {
  const players = Array.from({ length: count }, () => Keypair.generate());
  const passRent = await provider.connection.getMinimumBalanceForRentExemption(82);
  const walletRent = await provider.connection.getMinimumBalanceForRentExemption(0);
  for (let offset = 0; offset < count; offset += 20) {
    const funds = players.slice(offset, offset + 20).map(({ publicKey }) => SystemProgram.transfer({
      fromPubkey: authority.publicKey, toPubkey: publicKey, lamports: fee + passRent + walletRent,
    }));
    await provider.sendAndConfirm(new Transaction().add(...funds));
  }
  for (let offset = 0; offset < count; offset += 5) {
    const group = players.slice(offset, offset + 5);
    const entries = await Promise.all(group.map(({ publicKey }) => program.methods.buyEntry()
      .accountsPartial({ arena, player: publicKey }).instruction()));
    await provider.sendAndConfirm(new Transaction().add(...entries), group);
  }
  return sortKeys(players.map(({ publicKey }) => publicKey));
};

const benchmarkBatch = async (instruction: web3.TransactionInstruction, label: string) => {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    instruction,
  );
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
  const signed = await authority.signTransaction(tx);
  const bytes = signed.serialize().length;
  const { value } = await provider.connection.simulateTransaction(signed);
  assert.isNull(value.err, JSON.stringify(value.logs));
  assert.isAtMost(bytes, 1_232);
  assert.isBelow(value.unitsConsumed ?? Infinity, 150_000);
  console.info(`    ${label}: ${bytes} bytes, ${value.unitsConsumed} CU`);
};

describe("arena — escrow + entry pass", () => {
  const arenaId = freshArenaId();
  const { arena: arenaPda, escrow: escrowPda } = deriveArena(arenaId);

  it("init_arena creates the arena", async () => {
    await initArena(arenaId);

    const arena = await program.account.arena.fetch(arenaPda);
    assert.equal(arena.entryFeeLamports.toString(), entryFee.toString());
    assert.equal(arena.prizePoolLamports.toString(), "0");
    assert.equal(arena.platformFeeBps, platformFeeBps);
    assert.equal(arena.playerCount, 0);
    assert.deepEqual(arena.state, { open: {} });
  });

  it("rejects an arena with a fee other than 10%", async () => {
    await expectAnchorError(() => initArena(freshArenaId(), entryFee, 0), "InvalidPlatformFee");
  });

  it("rejects zero entry and decodes the legacy 137-byte Arena layout", async () => {
    await expectAnchorError(() => initArena(freshArenaId(), new BN(0)), "InvalidEntryFee");
    const account = await provider.connection.getAccountInfo(arenaPda);
    if (!account) throw new Error("missing Arena");
    // Legacy field offsets: 8-byte discriminator; state at 102; result hash starts at 103.
    assert.lengthOf(account.data, 137);
    const legacy = Buffer.from(account.data);
    for (const [i, expected] of ["open", "settled", "cancelled"].entries()) {
      legacy[102] = i;
      assert.deepEqual(program.coder.accounts.decode("arena", legacy).state, { [expected]: {} });
    }
  });

  it("buy_entry moves the fee into escrow and grows the pool", async () => {
    const before = await provider.connection.getBalance(escrowPda);
    const player = await buyIn(arenaPda);
    const after = await provider.connection.getBalance(escrowPda);

    assert.equal(after - before, entryFee.toNumber(), "escrow grew by the fee");

    const arena = await program.account.arena.fetch(arenaPda);
    assert.equal(arena.prizePoolLamports.toString(), entryFee.toString());
    assert.equal(arena.playerCount, 1);

    const pass = await program.account.entryPass.fetch(entryPassPda(arenaPda, player.publicKey));
    assert.equal(pass.player.toBase58(), player.publicKey.toBase58());
    assert.equal(pass.amountLamports.toString(), entryFee.toString());
    assert.equal(pass.refunded, false);
  });

  it("rejects a double entry from the same player", async () => {
    const player = await fundedPlayer();
    const buy = () =>
      program.methods
        .buyEntry()
      .accountsPartial({ arena: arenaPda, player: player.publicKey })
        .signers([player])
        .rpc();

    await buy();
    let threw = false;
    try {
      await buy();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "second entry by the same player must fail");
  });
});

describe("arena — payout", () => {
  const executableWinner = new PublicKey("4zjp5rbh9vBVc1tNAbpKygud5WKR31yBZeBZRBDzgFNg");
  before(async () => {
    if ((await provider.connection.getBalance(treasury)) === 0) {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: treasury,
          lamports: 0.001 * LAMPORTS_PER_SOL,
        }),
      );
      await provider.sendAndConfirm(transaction);
    }
  });

  for (const change of ["assign", "allocate"] as const) {
    it(`pays a winner who uses ${change} after an earlier batch`, async () => {
      const arenaId = freshArenaId();
      const { arena, escrow } = deriveArena(arenaId);
      await initArena(arenaId);
      const players = [await buyIn(arena), await buyIn(arena)]
        .sort((a, b) => Buffer.compare(a.publicKey.toBuffer(), b.publicKey.toBuffer()));
      const [first, last] = players;
      if (!first || !last) throw new Error("missing recipients");
      await startSettlement(arena, escrow, 2).rpc();
      await payBatch(arena, escrow, 0, [first.publicKey]).rpc();
      await provider.sendAndConfirm(new Transaction().add(change === "assign"
        ? SystemProgram.assign({ accountPubkey: last.publicKey, programId: executableWinner })
        : SystemProgram.allocate({ accountPubkey: last.publicKey, space: 32 })), [last]);
      const before = await provider.connection.getAccountInfo(last.publicKey);
      if (!before) throw new Error("missing mutated recipient");
      assert.equal(change === "assign" ? before.owner.toBase58() : before.data.length,
        change === "assign" ? executableWinner.toBase58() : 32);
      await payBatch(arena, escrow, 1, [last.publicKey]).rpc();
      assert.equal(await provider.connection.getBalance(last.publicKey), before.lamports + 90_000_000);
    });
  }

  it("skips an executable, advances the cursor and sweeps its unpaid share", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const players = await fundAndEnter(arena, 2, entryFee.toNumber());
    const [wallet] = players;
    if (!wallet) throw new Error("missing winner fixture");
    assert.isTrue((await provider.connection.getAccountInfo(executableWinner))?.executable);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    const executableBefore = await provider.connection.getBalance(executableWinner);
    const walletBefore = await provider.connection.getBalance(wallet);
    const winners = sortKeys([wallet, executableWinner]);
    await startSettlement(arena, escrow, 2).rpc();
    const skipIndex = winners.findIndex((key) => key.equals(executableWinner));
    let skipSignature = "";
    for (const [index, key] of winners.entries()) {
      const sig = await payBatch(arena, escrow, index, [key]).rpc(index === skipIndex ? finalized : undefined);
      if (index === skipIndex) {
        skipSignature = sig;
        const cursor = await program.account.settlement.fetch(settlementPda(arena));
        assert.equal(cursor.paidCount, index + 1);
        assert.equal(cursor.lastPaidKey.toBase58(), executableWinner.toBase58());
      }
    }
    const transaction = await provider.connection.getTransaction(skipSignature, { commitment: "finalized" });
    const parser = new anchor.EventParser(program.programId, program.coder);
    const skipped = [...parser.parseLogs(transaction?.meta?.logMessages ?? [])].filter((event) => event.name === "winnerSkipped");
    assert.deepEqual(skipped.map(({ data }) => [data.arena.toBase58(), data.index, data.winner.toBase58()]),
      [[arena.toBase58(), skipIndex, executableWinner.toBase58()]]);
    assert.equal(await provider.connection.getBalance(executableWinner), executableBefore);
    assert.equal(await provider.connection.getBalance(wallet), walletBefore + 90_000_000);
    assert.equal(await provider.connection.getBalance(treasury), treasuryBefore + 110_000_000);
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("pays 26 winners across batches, rejects replay and returns the settlement deposit", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    const funder = await fundedPlayer();
    await initArena(arenaId, new BN(1_000_007), platformFeeBps, funder.publicKey);
    const winners = (await fundAndEnter(arena, 27, 1_000_007)).slice(0, 26);
    const donation = 1_000_000;
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
      fromPubkey: authority.publicKey, toPubkey: escrow, lamports: donation,
    })));
    const settlement = settlementPda(arena);
    const balances = () => Promise.all(winners.map((winner) => provider.connection.getBalance(winner)));
    const before = await balances();
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await startSettlement(arena, escrow, 26).accountsPartial({ payoutAuthority: funder.publicKey })
      .signers([funder]).rpc();
    const pay = (expectedPaid: number, batch: web3.PublicKey[]) => payBatch(arena, escrow, expectedPaid, batch)
      .accountsPartial({ payoutAuthority: funder.publicKey }).signers([funder]);
    await pay(0, winners.slice(0, 20)).rpc();
    const partial = await balances();
    // 27 × 1,000,007 minus 2,700,018 rake, divided by 26 with 25 left over.
    assert.deepEqual(partial.map((balance, i) => balance - (before[i] ?? NaN)), [
      ...Array(20).fill(934_621), ...Array(6).fill(0),
    ]);
    assert.equal(await provider.connection.getBalance(treasury), treasuryBefore);
    await expectAnchorError(() => pay(0, winners.slice(0, 20))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 })])
      .rpc(), "StaleBatchCursor");
    assert.deepEqual(await balances(), partial);
    assert.equal((await program.account.settlement.fetch(settlement)).paidCount, 20);
    await pay(20, winners.slice(20)).rpc(finalized);
    assert.deepEqual((await balances()).map((balance, i) => balance - (before[i] ?? NaN)), Array(26).fill(934_621));
    assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, 3_700_043);
    assert.equal(await provider.connection.getBalance(escrow), 0);
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { settled: {} });

    const deposit = await provider.connection.getBalance(settlement, "finalized");
    assert.isAbove(deposit, 0);
    const funderBefore = await provider.connection.getBalance(funder.publicKey, "finalized");
    await closeSettlement(arena).accountsPartial({ payoutAuthority: funder.publicKey, funder: funder.publicKey })
      .signers([funder]).rpc(finalized);
    assert.isNull(await provider.connection.getAccountInfo(settlement, "finalized"));
    assert.equal(await provider.connection.getBalance(funder.publicKey, "finalized"), funderBefore + deposit);
  });

  for (const count of [200, 1_000]) {
    it(`pays all ${count} winners in bounded batches`, async function () {
      this.timeout(360_000);
      const arenaId = freshArenaId();
      const { arena, escrow } = deriveArena(arenaId);
      await initArena(arenaId, new BN(1_000_000));
      const winners = await fundAndEnter(arena, count, 1_000_000);
      const treasuryBefore = await provider.connection.getBalance(treasury);
      await startSettlement(arena, escrow, count).rpc();
      for (let paid = 0; paid < count; paid += 20) {
        const batch = payBatch(arena, escrow, paid, winners.slice(paid, paid + 20));
        if (count === 200 && paid === 0) {
          await expectAnchorError(() => payBatch(arena, escrow, 0, winners.slice(0, 21)).rpc(), "InvalidBatchSize");
          await benchmarkBatch(await batch.instruction(), "20-winner nonfinal batch");
        }
        if (count === 200 && paid === count - 20) {
          await benchmarkBatch(await batch.instruction(), "20-winner final batch");
        }
        await batch.rpc();
      }
      assert.equal(await provider.connection.getBalance(escrow), 0);
      assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, count * 100_000);
      const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
      for (let offset = 0; offset < count; offset += 100) {
        const accounts = await provider.connection.getMultipleAccountsInfo(winners.slice(offset, offset + 100));
        assert.isTrue(accounts.every((account) => account?.lamports === rent + 900_000));
      }
      assert.deepEqual((await program.account.arena.fetch(arena)).state, { settled: {} });
      await closeSettlement(arena).rpc();
    });
  }

  it("rejects invalid sizes, ordering, cursors, reserved accounts, and cancellation after payout", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId, new BN(1_000_000));
    const [first, second] = await fundAndEnter(arena, 2, 1_000_000);
    if (!first || !second) throw new Error("missing winner fixtures");
    await expectAnchorError(() => startSettlement(arena, escrow, 0).rpc(), "InvalidWinnerCount");
    await expectAnchorError(() => startSettlement(arena, escrow, 3).rpc(), "InvalidWinnerCount");
    await startSettlement(arena, escrow, 2).rpc();
    const pay = (expected: number, keys: web3.PublicKey[]) => payBatch(arena, escrow, expected, keys).rpc();
    await expectAnchorError(() => closeSettlement(arena).rpc(), "SettlementNotTerminal");
    await expectAnchorError(() => pay(0, []), "InvalidBatchSize");
    await expectAnchorError(() => pay(0, [first, second, treasury]), "InvalidBatchSize");
    await expectAnchorError(() => pay(1, [first]), "StaleBatchCursor");
    await expectAnchorError(() => pay(0, [first, first]), "WinnerOrder");
    await expectAnchorError(() => pay(0, [second, first]), "WinnerOrder");
    for (const key of [escrow, arena, settlementPda(arena), treasury, program.programId]) {
      await expectAnchorError(() => pay(0, [key]), "InvalidWinner");
    }
    await pay(0, [first]);
    await expectAnchorError(() => pay(1, [first]), "WinnerOrder");
    await expectAnchorError(() => program.methods.cancelArena().accountsPartial({
      arena, payoutAuthority: authority.publicKey, settlement: settlementPda(arena),
    }).rpc(), "PayoutStarted");
    await pay(1, [second]);
    await expectAnchorError(() => program.methods.closeSettlement().accountsPartial({
      arena, payoutAuthority: authority.publicKey, funder: second,
    }).rpc(), "ConstraintHasOne");
    await closeSettlement(arena).rpc();
    await expectAnchorError(() => startSettlement(arena, escrow, 2).rpc(), "ArenaNotOpen");
  });

  it("rejects an unfunded recipient for low shares and keeps the entire payout atomic", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
    await initArena(arenaId, new BN(rent));
    const winners = await fundAndEnter(arena, 2, rent);
    const [first] = winners;
    if (!first) throw new Error("missing winner fixture");
    await startSettlement(arena, escrow, 2).rpc();
    await expectAnchorError(() => payBatch(arena, escrow, 0, [first]).rpc(), "SmallShareRequiresSingleBatch");
    const emptyWallet = Keypair.generate().publicKey;
    await expectAnchorError(() => payBatch(arena, escrow, 0, sortKeys([first, emptyWallet])).rpc(), "RecipientRent");
    assert.equal((await program.account.settlement.fetch(settlementPda(arena))).paidCount, 0);
    assert.equal(await provider.connection.getBalance(escrow), rent * 2);
    await payBatch(arena, escrow, 0, winners).rpc();
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("keeps a large arena open when the share cannot safely be split across transactions", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
    await initArena(arenaId, new BN(rent));
    await fundAndEnter(arena, 21, rent);
    await expectAnchorError(() => startSettlement(arena, escrow, 21).rpc(), "SmallShareRequiresSingleBatch");
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { open: {} });
    assert.isNull(await provider.connection.getAccountInfo(settlementPda(arena)));
    assert.equal(await provider.connection.getBalance(escrow), 21 * rent);
  });

  it("pays 10% to treasury and the remaining pool to a single winner", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);
    await buyIn(arena);
    const pool = entryFee.toNumber() * 2;
    const expectedFee = pool / 10;

    const before = await provider.connection.getBalance(p1.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await startSettlement(arena, escrow, 1).rpc();
    await payBatch(arena, escrow, 0, [p1.publicKey]).rpc();
    const after = await provider.connection.getBalance(p1.publicKey);

    assert.equal(after - before, pool - expectedFee, "winner receives the distributable pool");
    assert.equal(
      (await provider.connection.getBalance(treasury)) - treasuryBefore,
      expectedFee,
      "treasury receives the platform fee",
    );
    assert.equal(await provider.connection.getBalance(escrow), 0, "escrow drained");

    const state = await program.account.arena.fetch(arena);
    assert.deepEqual(state.state, { settled: {} });
    assert.equal(state.prizePoolLamports.toString(), "0");
  });

  it("rounds the fee down and sends the split remainder to treasury", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId, new BN(1_000_007));
    const p1 = await buyIn(arena);
    const p2 = await buyIn(arena);

    const b1 = await provider.connection.getBalance(p1.publicKey);
    const b2 = await provider.connection.getBalance(p2.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await startSettlement(arena, escrow, 2).rpc();
    await payBatch(arena, escrow, 0, sortKeys([p1.publicKey, p2.publicKey])).rpc();

    assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, 200_002);
    assert.equal((await provider.connection.getBalance(p1.publicKey)) - b1, 900_006);
    assert.equal((await provider.connection.getBalance(p2.publicKey)) - b2, 900_006);
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("leaves the winner share unchanged and sweeps unsolicited deposits to treasury", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    const donation = 1_000_000;
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: escrow,
          lamports: donation,
        }),
      ),
    );

    const winnerBefore = await provider.connection.getBalance(winner.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await startSettlement(arena, escrow, 1).rpc();
    await payBatch(arena, escrow, 0, [winner.publicKey]).rpc();

    const expectedFee = entryFee.toNumber() / 10;
    assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, expectedFee + donation);
    assert.equal(
      (await provider.connection.getBalance(winner.publicKey)) - winnerBefore,
      entryFee.toNumber() - expectedFee,
    );
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("rejects an incorrect treasury", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    const incorrectTreasury = (await fundedPlayer()).publicKey;
    await startSettlement(arena, escrow, 1).rpc();

    await expectAnchorError(
      () =>
        program.methods
          .payBatch(0)
          .accountsPartial({ ...payoutAccounts(arena, escrow), treasury: incorrectTreasury })
          .remainingAccounts([writableWinner(winner.publicKey)])
          .rpc(),
      "InvalidTreasury",
    );
  });

  it("rejects a read-only recipient and leaves all balances and the cursor unchanged", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    await startSettlement(arena, escrow, 1).rpc();
    const escrowBefore = await provider.connection.getBalance(escrow);
    const winnerBefore = await provider.connection.getBalance(winner.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);

    await expectAnchorError(() => program.methods
        .payBatch(0)
        .accounts(payoutAccounts(arena, escrow))
        .remainingAccounts([{ pubkey: winner.publicKey, isWritable: false, isSigner: false }])
        .rpc(), "InvalidWinner");

    assert.equal(await provider.connection.getBalance(escrow), escrowBefore);
    assert.equal(await provider.connection.getBalance(winner.publicKey), winnerBefore);
    assert.equal(await provider.connection.getBalance(treasury), treasuryBefore);
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { settling: {} });
    assert.equal((await program.account.settlement.fetch(settlementPda(arena))).paidCount, 0);
  });

  it("rejects an unauthorized payout authority", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);
    const impostor = await fundedPlayer();

    await expectAnchorError(() => program.methods.startSettlement(1)
      .accountsPartial({ arena, escrow, treasury, payoutAuthority: impostor.publicKey })
      .signers([impostor]).rpc(), "Unauthorized");
    await startSettlement(arena, escrow, 1).rpc();
    await expectAnchorError(() => program.methods.payBatch(0)
      .accounts({ ...payoutAccounts(arena, escrow), payoutAuthority: impostor.publicKey })
      .remainingAccounts([writableWinner(p1.publicKey)]).signers([impostor]).rpc(), "Unauthorized");
  });

  it("cannot settle twice", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);

    const settle = () => payBatch(arena, escrow, 0, [p1.publicKey]).rpc();

    await startSettlement(arena, escrow, 1).rpc();
    await settle();
    const treasuryAfterSettlement = await provider.connection.getBalance(treasury);
    await expectAnchorError(settle, "NotSettling");
    assert.equal(
      await provider.connection.getBalance(treasury),
      treasuryAfterSettlement,
      "failed repeat settlement cannot pay the fee twice",
    );
  });
});

describe("arena — cancellation + refund", () => {
  it("preserves legacy cancellation and allows cancellation before the first batch", async () => {
    const legacyId = freshArenaId();
    const { arena: legacy } = deriveArena(legacyId);
    await initArena(legacyId);
    const instruction = await program.methods.cancelArena().accountsPartial({
      arena: legacy, payoutAuthority: authority.publicKey, settlement: null,
    }).instruction();
    instruction.keys = instruction.keys.slice(0, 2);
    await provider.sendAndConfirm(new Transaction().add(instruction));
    assert.deepEqual((await program.account.arena.fetch(legacy)).state, { cancelled: {} });

    const id = freshArenaId();
    const { arena, escrow } = deriveArena(id);
    await initArena(id);
    const player = await buyIn(arena);
    await startSettlement(arena, escrow, 1).rpc();
    const settlement = settlementPda(arena);
    await expectAnchorError(() => program.methods.cancelArena().accountsPartial({
      arena, payoutAuthority: authority.publicKey, settlement: null,
    }).rpc(), "MissingSettlement");
    await expectAnchorError(() => program.methods.refund().accountsPartial({
      arena, escrow, player: player.publicKey, entryPass: entryPassPda(arena, player.publicKey),
    }).rpc(), "NotCancelled");
    await program.methods.cancelArena().accountsPartial({
      arena, payoutAuthority: authority.publicKey, settlement,
    }).rpc();
    await closeSettlement(arena).rpc();
    assert.isNull(await provider.connection.getAccountInfo(settlement));
    const before = await provider.connection.getBalance(player.publicKey);
    await program.methods.refund().accountsPartial({
      arena, escrow, player: player.publicKey, entryPass: entryPassPda(arena, player.publicKey),
    }).rpc();
    assert.equal(await provider.connection.getBalance(player.publicKey), before + entryFee.toNumber());
  });

  it("rejects an unauthorized cancellation", async () => {
    const arenaId = freshArenaId();
    const { arena } = deriveArena(arenaId);
    await initArena(arenaId);
    const impostor = await fundedPlayer();

    let threw = false;
    try {
      await program.methods
        .cancelArena()
        .accountsPartial({ arena, payoutAuthority: impostor.publicKey, settlement: null })
        .signers([impostor])
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "only the payout authority may cancel");
  });

  it("refunds exactly once without the player signing and blocks later entries", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const player = await buyIn(arena);
    const entryPass = entryPassPda(arena, player.publicKey);

    await program.methods
      .cancelArena()
      .accountsPartial({ arena, payoutAuthority: authority.publicKey, settlement: null })
      .rpc();
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { cancelled: {} });

    const before = await provider.connection.getBalance(player.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await program.methods
      .refund()
      .accountsPartial({ arena, entryPass, escrow, player: player.publicKey })
      .rpc();
    const after = await provider.connection.getBalance(player.publicKey);
    assert.equal(after - before, entryFee.toNumber(), "player receives the exact entry fee");
    assert.equal(
      await provider.connection.getBalance(treasury),
      treasuryBefore,
      "cancelled arenas do not charge the platform fee",
    );

    const state = await program.account.arena.fetch(arena);
    const pass = await program.account.entryPass.fetch(entryPass);
    assert.equal(state.prizePoolLamports.toString(), "0");
    assert.equal(state.playerCount, 0);
    assert.equal(pass.refunded, true);

    for (const operation of [
      () => program.methods.refund().accountsPartial({ arena, entryPass, escrow, player: player.publicKey }).rpc(),
      async () => {
        const latePlayer = await fundedPlayer();
        await program.methods
          .buyEntry()
          .accountsPartial({ arena, player: latePlayer.publicKey })
          .signers([latePlayer])
          .rpc();
      },
    ]) {
      let threw = false;
      try {
        await operation();
      } catch (_e) {
        threw = true;
      }
      assert.isTrue(threw);
    }
  });
});

describe("arena — result + badge", () => {
  const badgePda = (arena: web3.PublicKey, winner: web3.PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("badge"), arena.toBuffer(), winner.toBuffer()],
      program.programId,
    )[0];

  const settledArena = async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    await startSettlement(arena, escrow, 1).rpc();
    await payBatch(arena, escrow, 0, [winner.publicKey]).rpc();
    return { arena, winner };
  };

  it("records the result hash after settlement", async () => {
    const { arena } = await settledArena();
    const hash = Array.from({ length: 32 }, (_, i) => i);

    await program.methods
      .recordResult(hash)
      .accountsPartial({ arena, payoutAuthority: authority.publicKey })
      .rpc();

    const state = await program.account.arena.fetch(arena);
    assert.deepEqual(Array.from(state.resultHash), hash);
  });

  it("awards a winner badge, and rejects a duplicate", async () => {
    const { arena, winner } = await settledArena();

    await program.methods
      .awardBadge()
      .accountsPartial({ arena, winner: winner.publicKey, payoutAuthority: authority.publicKey })
      .rpc();

    const badge = await program.account.winnerBadge.fetch(badgePda(arena, winner.publicKey));
    assert.equal(badge.winner.toBase58(), winner.publicKey.toBase58());
    assert.equal(badge.arena.toBase58(), arena.toBase58());

    let threw = false;
    try {
      await program.methods
        .awardBadge()
        .accountsPartial({ arena, winner: winner.publicKey, payoutAuthority: authority.publicKey })
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "cannot award the same winner twice");
  });

  it("rejects an unauthorized result record", async () => {
    const { arena } = await settledArena();
    const impostor = await fundedPlayer();

    let threw = false;
    try {
      await program.methods
        .recordResult(Array(32).fill(0))
        .accountsPartial({ arena, payoutAuthority: impostor.publicKey })
        .signers([impostor])
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "only the payout authority may record the result");
  });
});
