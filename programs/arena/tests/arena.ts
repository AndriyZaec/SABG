import anchor from "@coral-xyz/anchor";
import chai from "chai";
import type { Program } from "@coral-xyz/anchor";
import type { Arena as ArenaProgram } from "../target/types/arena";

const { AnchorProvider, BN, setProvider, workspace, web3 } = anchor;
const { PublicKey, Keypair, LAMPORTS_PER_SOL } = web3;
const { assert } = chai;

const provider = AnchorProvider.env();
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
    const transaction = new web3.Transaction().add(
      web3.SystemProgram.transfer({
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
) =>
  program.methods
    .initArena(arenaId, arenaEntryFee, authority.publicKey, arenaPlatformFeeBps)
    .accounts({ authority: authority.publicKey })
    .rpc();

const buyIn = async (arena: web3.PublicKey): Promise<web3.Keypair> => {
  const player = await fundedPlayer();
  await program.methods
    .buyEntry()
    .accounts({ arena, player: player.publicKey })
    .signers([player])
    .rpc();
  return player;
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
        .accounts({ arena: arenaPda, player: player.publicKey })
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
  const writableWinner = (pubkey: web3.PublicKey) => ({ pubkey, isWritable: true, isSigner: false });

  before(async () => {
    if ((await provider.connection.getBalance(treasury)) === 0) {
      const transaction = new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: treasury,
          lamports: 0.001 * LAMPORTS_PER_SOL,
        }),
      );
      await provider.sendAndConfirm(transaction);
    }
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
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
      .remainingAccounts([writableWinner(p1.publicKey)])
      .rpc();
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

  it("rounds the fee down and gives the winner remainder to the first winner", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId, new BN(1_000_007));
    const p1 = await buyIn(arena);
    const p2 = await buyIn(arena);

    const b1 = await provider.connection.getBalance(p1.publicKey);
    const b2 = await provider.connection.getBalance(p2.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
      .remainingAccounts([writableWinner(p1.publicKey), writableWinner(p2.publicKey)])
      .rpc();

    assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, 200_001);
    assert.equal((await provider.connection.getBalance(p1.publicKey)) - b1, 900_007);
    assert.equal((await provider.connection.getBalance(p2.publicKey)) - b2, 900_006);
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("does not charge the platform fee on unsolicited escrow deposits", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    const donation = 1_000_000;
    await provider.sendAndConfirm(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: escrow,
          lamports: donation,
        }),
      ),
    );

    const winnerBefore = await provider.connection.getBalance(winner.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
      .remainingAccounts([writableWinner(winner.publicKey)])
      .rpc();

    const expectedFee = entryFee.toNumber() / 10;
    assert.equal((await provider.connection.getBalance(treasury)) - treasuryBefore, expectedFee);
    assert.equal(
      (await provider.connection.getBalance(winner.publicKey)) - winnerBefore,
      entryFee.toNumber() - expectedFee + donation,
    );
    assert.equal(await provider.connection.getBalance(escrow), 0);
  });

  it("rejects an incorrect treasury", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    const incorrectTreasury = (await fundedPlayer()).publicKey;

    await expectAnchorError(
      () =>
        program.methods
          .settlePayout()
          .accounts({ arena, escrow, treasury: incorrectTreasury, payoutAuthority: authority.publicKey })
          .remainingAccounts([writableWinner(winner.publicKey)])
          .rpc(),
      "InvalidTreasury",
    );
  });

  it("rolls back the fee transfer when a winner transfer fails", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const winner = await buyIn(arena);
    const escrowBefore = await provider.connection.getBalance(escrow);
    const winnerBefore = await provider.connection.getBalance(winner.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);

    let threw = false;
    try {
      await program.methods
        .settlePayout()
        .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
        .remainingAccounts([{ pubkey: winner.publicKey, isWritable: false, isSigner: false }])
        .rpc();
    } catch (_e) {
      threw = true;
    }

    assert.isTrue(threw, "a read-only winner must make settlement fail");
    assert.equal(await provider.connection.getBalance(escrow), escrowBefore);
    assert.equal(await provider.connection.getBalance(winner.publicKey), winnerBefore);
    assert.equal(await provider.connection.getBalance(treasury), treasuryBefore);
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { open: {} });
  });

  it("rejects an unauthorized payout authority", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);
    const impostor = await fundedPlayer();

    let threw = false;
    try {
      await program.methods
        .settlePayout()
        .accounts({ arena, escrow, treasury, payoutAuthority: impostor.publicKey })
        .remainingAccounts([writableWinner(p1.publicKey)])
        .signers([impostor])
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "only the payout authority may settle");
  });

  it("cannot settle twice", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);

    const settle = () =>
      program.methods
        .settlePayout()
        .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
        .remainingAccounts([writableWinner(p1.publicKey)])
        .rpc();

    await settle();
    const treasuryAfterSettlement = await provider.connection.getBalance(treasury);
    await expectAnchorError(settle, "ArenaNotOpen");
    assert.equal(
      await provider.connection.getBalance(treasury),
      treasuryAfterSettlement,
      "failed repeat settlement cannot pay the fee twice",
    );
  });
});

describe("arena — cancellation + refund", () => {
  it("rejects an unauthorized cancellation", async () => {
    const arenaId = freshArenaId();
    const { arena } = deriveArena(arenaId);
    await initArena(arenaId);
    const impostor = await fundedPlayer();

    let threw = false;
    try {
      await program.methods
        .cancelArena()
        .accounts({ arena, payoutAuthority: impostor.publicKey })
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
      .accounts({ arena, payoutAuthority: authority.publicKey })
      .rpc();
    assert.deepEqual((await program.account.arena.fetch(arena)).state, { cancelled: {} });

    const before = await provider.connection.getBalance(player.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury);
    await program.methods
      .refund()
      .accounts({ arena, entryPass, escrow, player: player.publicKey })
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
      () => program.methods.refund().accounts({ arena, entryPass, escrow, player: player.publicKey }).rpc(),
      async () => {
        const latePlayer = await fundedPlayer();
        await program.methods
          .buyEntry()
          .accounts({ arena, player: latePlayer.publicKey })
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
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, treasury, payoutAuthority: authority.publicKey })
      .remainingAccounts([{ pubkey: winner.publicKey, isWritable: true, isSigner: false }])
      .rpc();
    return { arena, winner };
  };

  it("records the result hash after settlement", async () => {
    const { arena } = await settledArena();
    const hash = Array.from({ length: 32 }, (_, i) => i);

    await program.methods
      .recordResult(hash)
      .accounts({ arena, payoutAuthority: authority.publicKey })
      .rpc();

    const state = await program.account.arena.fetch(arena);
    assert.deepEqual(Array.from(state.resultHash), hash);
  });

  it("awards a winner badge, and rejects a duplicate", async () => {
    const { arena, winner } = await settledArena();

    await program.methods
      .awardBadge()
      .accounts({ arena, winner: winner.publicKey, payoutAuthority: authority.publicKey })
      .rpc();

    const badge = await program.account.winnerBadge.fetch(badgePda(arena, winner.publicKey));
    assert.equal(badge.winner.toBase58(), winner.publicKey.toBase58());
    assert.equal(badge.arena.toBase58(), arena.toBase58());

    let threw = false;
    try {
      await program.methods
        .awardBadge()
        .accounts({ arena, winner: winner.publicKey, payoutAuthority: authority.publicKey })
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
        .accounts({ arena, payoutAuthority: impostor.publicKey })
        .signers([impostor])
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "only the payout authority may record the result");
  });
});
