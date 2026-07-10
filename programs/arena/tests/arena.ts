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

const fundedPlayer = async (): Promise<web3.Keypair> => {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, "confirmed");
  return kp;
};

const initArena = async (arenaId: anchor.BN) =>
  program.methods
    .initArena(arenaId, entryFee, authority.publicKey, 0)
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
    assert.equal(arena.playerCount, 0);
    assert.equal(arena.settled, false);
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

  it("pays the whole pool to a single winner and marks the arena settled", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);
    await buyIn(arena);
    const pool = entryFee.toNumber() * 2;

    const before = await provider.connection.getBalance(p1.publicKey);
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, payoutAuthority: authority.publicKey })
      .remainingAccounts([writableWinner(p1.publicKey)])
      .rpc();
    const after = await provider.connection.getBalance(p1.publicKey);

    assert.equal(after - before, pool, "winner receives the whole pool");
    assert.equal(await provider.connection.getBalance(escrow), 0, "escrow drained");

    const state = await program.account.arena.fetch(arena);
    assert.equal(state.settled, true);
    assert.equal(state.prizePoolLamports.toString(), "0");
  });

  it("splits the pool equally between winners", async () => {
    const arenaId = freshArenaId();
    const { arena, escrow } = deriveArena(arenaId);
    await initArena(arenaId);
    const p1 = await buyIn(arena);
    const p2 = await buyIn(arena);

    const b1 = await provider.connection.getBalance(p1.publicKey);
    const b2 = await provider.connection.getBalance(p2.publicKey);
    await program.methods
      .settlePayout()
      .accounts({ arena, escrow, payoutAuthority: authority.publicKey })
      .remainingAccounts([writableWinner(p1.publicKey), writableWinner(p2.publicKey)])
      .rpc();

    assert.equal((await provider.connection.getBalance(p1.publicKey)) - b1, entryFee.toNumber());
    assert.equal((await provider.connection.getBalance(p2.publicKey)) - b2, entryFee.toNumber());
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
        .accounts({ arena, escrow, payoutAuthority: impostor.publicKey })
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
        .accounts({ arena, escrow, payoutAuthority: authority.publicKey })
        .remainingAccounts([writableWinner(p1.publicKey)])
        .rpc();

    await settle();
    let threw = false;
    try {
      await settle();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "second settle must fail");
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
      .accounts({ arena, escrow, payoutAuthority: authority.publicKey })
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
