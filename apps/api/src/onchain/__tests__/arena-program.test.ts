import { describe, expect, it } from "vitest";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  assertAuthorityCanProvision,
  assertArenaRecyclableState,
  assertEscrowEmpty,
  deriveArenaPdas,
  deriveOnchainArenaId,
  loadKeypair,
  verifyPreparedEntryTransaction,
} from "../arena-program.js";

const PROGRAM_ID = new PublicKey("84o7QQ3vkGkm3D6wfaqEHxFN93p3Q2b6SFtfazzxZuxH");

describe("deriveArenaPdas", () => {
  it("is deterministic for a given arena id", () => {
    const a = deriveArenaPdas(PROGRAM_ID, new anchor.BN(7));
    const b = deriveArenaPdas(PROGRAM_ID, new anchor.BN(7));
    expect(a.arena.toBase58()).toBe(b.arena.toBase58());
    expect(a.escrow.toBase58()).toBe(b.escrow.toBase58());
  });

  it("gives different arenas (and escrows) for different ids", () => {
    const a = deriveArenaPdas(PROGRAM_ID, new anchor.BN(1));
    const b = deriveArenaPdas(PROGRAM_ID, new anchor.BN(2));
    expect(a.arena.toBase58()).not.toBe(b.arena.toBase58());
    expect(a.escrow.toBase58()).not.toBe(b.escrow.toBase58());
  });

  it("derives escrow from the arena PDA (matches the program seeds)", () => {
    const { arena, escrow } = deriveArenaPdas(PROGRAM_ID, new anchor.BN(42));
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), arena.toBuffer()],
      PROGRAM_ID,
    );
    expect(escrow.toBase58()).toBe(expected.toBase58());
  });
});

describe("loadKeypair", () => {
  it("loads the same key from a JSON byte array and its base58 form", () => {
    const kp = Keypair.generate();
    const fromJson = loadKeypair(JSON.stringify(Array.from(kp.secretKey)));
    const fromBs58 = loadKeypair(bs58.encode(kp.secretKey));
    expect(fromJson.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(fromBs58.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });
});

describe("automatic arena cycling safety", () => {
  it("derives a stable safe-integer on-chain id from the database arena id", () => {
    const databaseArenaId = "123e4567-e89b-12d3-a456-426614174000";
    const secret = Keypair.generate().secretKey;
    const otherSecret = Keypair.generate().secretKey;
    expect(deriveOnchainArenaId(databaseArenaId, secret)).toBe(
      deriveOnchainArenaId(databaseArenaId, Uint8Array.from(secret)),
    );
    expect(deriveOnchainArenaId(databaseArenaId, secret)).not.toBe(
      deriveOnchainArenaId(databaseArenaId, otherSecret),
    );
    expect(Number.isSafeInteger(deriveOnchainArenaId(databaseArenaId, secret))).toBe(true);
    expect(() => deriveOnchainArenaId("not-a-uuid", secret)).toThrow("Invalid database arena UUID");
  });

  it("keeps the configured authority reserve after rent and fee headroom", () => {
    expect(() => assertAuthorityCanProvision(51_000_000, 900_000, 50_000_000)).not.toThrow();
    expect(() => assertAuthorityCanProvision(50_909_999, 900_000, 50_000_000)).toThrow(
      "below the required",
    );
  });

  it("refuses to recycle an arena while escrow still contains player funds", () => {
    expect(() => assertArenaRecyclableState(true, 0, 42)).not.toThrow();
    expect(() => assertArenaRecyclableState(false, 0, 42)).toThrow("arena is not settled");
    expect(() => assertArenaRecyclableState(true, 1, 42)).toThrow("escrow still holds 1 lamports");
  });
});

describe("prepared entry transaction verification", () => {
  it("accepts only the prepared message signed by the expected wallet", () => {
    const wallet = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    const transaction = new Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 1 }),
    );
    const prepared = transaction.serialize({ requireAllSignatures: false }).toString("base64");
    transaction.sign(wallet);
    const signed = transaction.serialize().toString("base64");

    expect(verifyPreparedEntryTransaction(prepared, signed, wallet.publicKey.toBase58())).toEqual({
      ok: true,
      blockhashRefreshed: false,
    });
    expect(verifyPreparedEntryTransaction(prepared, signed, recipient.toBase58())).toEqual({
      ok: false,
      reason: "unexpected_signers",
    });

    const refreshed = Transaction.from(Buffer.from(prepared, "base64"));
    refreshed.recentBlockhash = Keypair.generate().publicKey.toBase58();
    refreshed.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        refreshed.serialize().toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: true, blockhashRefreshed: true });

    expect(verifyPreparedEntryTransaction(prepared, prepared, wallet.publicKey.toBase58())).toEqual({
      ok: false,
      reason: "wallet_signature_missing",
    });

    const tamperedSignature = Transaction.from(Buffer.from(signed, "base64"));
    const signatureBytes = tamperedSignature.signatures[0]?.signature;
    if (signatureBytes === null || signatureBytes === undefined) throw new Error("test signature is missing");
    signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 1;
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        tamperedSignature.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "wallet_signature_invalid" });

    const changedProgram = Transaction.from(Buffer.from(prepared, "base64"));
    changedProgram.instructions[0]!.programId = Keypair.generate().publicKey;
    changedProgram.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        changedProgram.serialize().toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "message_changed" });

    const changedAccounts = Transaction.from(Buffer.from(prepared, "base64"));
    changedAccounts.instructions[0]!.keys[1]!.pubkey = Keypair.generate().publicKey;
    changedAccounts.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        changedAccounts.serialize().toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "message_changed" });

    const reorderedAccounts = Transaction.from(Buffer.from(prepared, "base64"));
    reorderedAccounts.instructions[0]!.keys.reverse();
    reorderedAccounts.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        reorderedAccounts.serialize().toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "message_changed" });

    const changedData = Transaction.from(Buffer.from(prepared, "base64"));
    const instructionData = changedData.instructions[0]?.data;
    if (instructionData === undefined) throw new Error("test instruction data is missing");
    instructionData[0] = (instructionData[0] ?? 0) ^ 1;
    changedData.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        changedData.serialize().toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "message_changed" });

    const addedSigner = Transaction.from(Buffer.from(prepared, "base64"));
    addedSigner.instructions[0]!.keys.push({
      pubkey: Keypair.generate().publicKey,
      isSigner: true,
      isWritable: false,
    });
    addedSigner.partialSign(wallet);
    expect(
      verifyPreparedEntryTransaction(
        prepared,
        addedSigner.serialize({ requireAllSignatures: false }).toString("base64"),
        wallet.publicKey.toBase58(),
      ),
    ).toEqual({ ok: false, reason: "message_changed" });

    const unrelated = new Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 2 }));
    unrelated.sign(wallet);
    expect(
      verifyPreparedEntryTransaction(prepared, unrelated.serialize().toString("base64"), wallet.publicKey.toBase58()),
    ).toEqual({ ok: false, reason: "message_changed" });
  });
});
