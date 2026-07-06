// ed25519 verification of a wallet-signed message. Isomorphic.

import nacl from "tweetnacl";
import bs58 from "bs58";
import type { WalletSignInRequest } from "@arena/contracts";

export interface VerifyInput {
  /** The exact message string that was signed. */
  message: string;
  /** Detached signature, base58-encoded. */
  signature: string;
  /** Signer's wallet address, base58. */
  walletAddress: string;
}

/** True iff `signature` is a valid ed25519 signature of `message` by `walletAddress`. */
export function verifyWalletSignature(input: VerifyInput): boolean {
  try {
    const message = new TextEncoder().encode(input.message);
    const signature = bs58.decode(input.signature);
    const publicKey = bs58.decode(input.walletAddress);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/** Convenience over the shared sign-in DTO. Does not check nonce freshness — the caller must. */
export function verifyWalletSignInRequest(req: WalletSignInRequest): boolean {
  return verifyWalletSignature({
    message: req.message,
    signature: req.signature,
    walletAddress: req.walletAddress,
  });
}
