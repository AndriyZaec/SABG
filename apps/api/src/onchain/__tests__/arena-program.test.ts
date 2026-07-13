import { describe, expect, it } from "vitest";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { deriveArenaPdas, loadKeypair } from "../arena-program.js";

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
