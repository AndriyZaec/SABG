import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildSignInMessage,
  generateNonce,
  verifyWalletSignature,
} from "../src/index.js";

const sign = (message: string, secretKey: Uint8Array) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));

describe("wallet sign-in", () => {
  const kp = nacl.sign.keyPair();
  const walletAddress = bs58.encode(kp.publicKey);
  const message = buildSignInMessage({
    domain: "sabg.app",
    address: walletAddress,
    nonce: generateNonce(),
    issuedAt: "2026-01-01T00:00:00.000Z",
  });

  it("accepts a valid signature", () => {
    const signature = sign(message, kp.secretKey);
    expect(verifyWalletSignature({ message, signature, walletAddress })).toBe(true);
  });

  it("rejects a tampered message", () => {
    const signature = sign(message, kp.secretKey);
    expect(
      verifyWalletSignature({ message: message + " ", signature, walletAddress }),
    ).toBe(false);
  });

  it("rejects a signature from a different wallet", () => {
    const other = nacl.sign.keyPair();
    const signature = sign(message, other.secretKey);
    expect(verifyWalletSignature({ message, signature, walletAddress })).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(
      verifyWalletSignature({ message, signature: "not-base58!!", walletAddress }),
    ).toBe(false);
    expect(
      verifyWalletSignature({ message, signature: bs58.encode(new Uint8Array(10)), walletAddress }),
    ).toBe(false);
  });

  it("nonce is random", () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });
});
