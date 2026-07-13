// On-chain arena provisioning: the backend acts as the arena `authority` + `payout_authority`,
// creating the arena via the deployed program. Loaded only when provisioning is enabled.

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ARENA_IDL } from "@arena/contracts/onchain";
import { onchainConfig } from "./config.js";

/** Accepts a JSON byte array or a base58 secret, matching the live worker's key format. */
export function loadKeypair(secret: string): Keypair {
  if (secret.trim().startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
  }
  return Keypair.fromSecretKey(bs58.decode(secret));
}

/** Arena + escrow PDAs for a numeric arena id (pure — same seeds as the program & frontend). */
export function deriveArenaPdas(programId: PublicKey, arenaId: anchor.BN) {
  const idBuf = arenaId.toArrayLike(Buffer, "le", 8);
  const [arena] = PublicKey.findProgramAddressSync([Buffer.from("arena"), idBuf], programId);
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), arena.toBuffer()],
    programId,
  );
  return { arena, escrow };
}

/**
 * Loosely-typed method builder: the generated IDL types target a newer anchor than apps/api
 * pins, but the camelCase method + accounts/remainingAccounts resolve at runtime from the IDL.
 */
type RpcBuilder = {
  accounts: (a: Record<string, PublicKey>) => RpcBuilder;
  remainingAccounts: (r: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[]) => RpcBuilder;
  rpc: () => Promise<string>;
};
type LooseMethods = Record<string, (...args: unknown[]) => RpcBuilder>;

function buildProgram(): { program: anchor.Program; authority: Keypair } {
  if (!onchainConfig.authoritySecret) {
    throw new Error("ARENA_AUTHORITY_SECRET is required for on-chain arena operations");
  }
  const authority = loadKeypair(onchainConfig.authoritySecret);
  const connection = new Connection(onchainConfig.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  return { program: new anchor.Program(ARENA_IDL as anchor.Idl, provider), authority };
}

export interface ProvisionedArena {
  onchainArenaId: number;
  escrowAccount: string;
  signature: string;
}

/** Create a fresh on-chain arena as the service authority; returns the ids to persist. */
export async function provisionArena(entryFeeLamports: number): Promise<ProvisionedArena> {
  const { program, authority } = buildProgram();
  const onchainArenaId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const arenaId = new anchor.BN(onchainArenaId);
  const { arena, escrow } = deriveArenaPdas(program.programId, arenaId);

  // Backend is both authority and payout_authority; platform fee 0 for MVP.
  const signature = await (program.methods as unknown as LooseMethods)
    .initArena!(arenaId, new anchor.BN(entryFeeLamports), authority.publicKey, 0)
    .accounts({ arena, escrow, authority: authority.publicKey })
    .rpc();

  return { onchainArenaId, escrowAccount: escrow.toBase58(), signature };
}

/** Settle an arena's escrow to the winner wallets (equal split on-chain); returns the tx sig. */
export async function settlePayoutOnchain(
  onchainArenaId: number,
  winnerWallets: string[],
): Promise<string> {
  const { program, authority } = buildProgram();
  const { arena, escrow } = deriveArenaPdas(program.programId, new anchor.BN(onchainArenaId));
  const remainingAccounts = winnerWallets.map((w) => ({
    pubkey: new PublicKey(w),
    isWritable: true,
    isSigner: false,
  }));

  return (program.methods as unknown as LooseMethods)
    .settlePayout!()
    .accounts({ arena, escrow, payoutAuthority: authority.publicKey })
    .remainingAccounts(remainingAccounts)
    .rpc();
}
