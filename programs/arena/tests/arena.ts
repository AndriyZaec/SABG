import anchor from "@coral-xyz/anchor";
import chai from "chai";
import type { Program } from "@coral-xyz/anchor";
import type { Arena as ArenaProgram } from "../target/types/arena";

const { AnchorProvider, BN, setProvider, workspace, web3 } = anchor;
const { PublicKey, Keypair, LAMPORTS_PER_SOL } = web3;
const { assert } = chai;

describe("arena — escrow + entry pass", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);

  const program = workspace.Arena as Program<ArenaProgram>;
  const authority = provider.wallet as anchor.Wallet;

  const arenaId = new BN(Date.now());
  const entryFee = new BN(0.1 * LAMPORTS_PER_SOL);

  const arenaIdBuf = arenaId.toArrayLike(Buffer, "le", 8);
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaIdBuf],
    program.programId,
  );
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), arenaPda.toBuffer()],
    program.programId,
  );

  const entryPassPda = (player: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("entry"), arenaPda.toBuffer(), player.toBuffer()],
      program.programId,
    )[0];

  const fundedPlayer = async (): Promise<Keypair> => {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
    return kp;
  };

  it("init_arena creates the arena", async () => {
    await program.methods
      .initArena(arenaId, entryFee, authority.publicKey, 0)
      .accounts({ authority: authority.publicKey })
      .rpc();

    const arena = await program.account.arena.fetch(arenaPda);
    assert.equal(arena.entryFeeLamports.toString(), entryFee.toString());
    assert.equal(arena.prizePoolLamports.toString(), "0");
    assert.equal(arena.playerCount, 0);
    assert.equal(arena.settled, false);
  });

  it("buy_entry moves the fee into escrow and grows the pool", async () => {
    const player = await fundedPlayer();
    const before = await provider.connection.getBalance(escrowPda);

    await program.methods
      .buyEntry()
      .accounts({ arena: arenaPda, player: player.publicKey })
      .signers([player])
      .rpc();

    const after = await provider.connection.getBalance(escrowPda);
    assert.equal(after - before, entryFee.toNumber(), "escrow grew by the fee");

    const arena = await program.account.arena.fetch(arenaPda);
    assert.equal(arena.prizePoolLamports.toString(), entryFee.toString());
    assert.equal(arena.playerCount, 1);

    const pass = await program.account.entryPass.fetch(
      entryPassPda(player.publicKey),
    );
    assert.equal(pass.player.toBase58(), player.publicKey.toBase58());
    assert.equal(pass.amountLamports.toString(), entryFee.toString());
    assert.equal(pass.refunded, false);
  });

  it("rejects a double entry from the same player", async () => {
    const player = await fundedPlayer();

    await program.methods
      .buyEntry()
      .accounts({ arena: arenaPda, player: player.publicKey })
      .signers([player])
      .rpc();

    let threw = false;
    try {
      await program.methods
        .buyEntry()
        .accounts({ arena: arenaPda, player: player.publicKey })
        .signers([player])
        .rpc();
    } catch (_e) {
      threw = true;
    }
    assert.isTrue(threw, "second entry by the same player must fail");
  });
});
