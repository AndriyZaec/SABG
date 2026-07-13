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

export interface ProvisionedArena {
  onchainArenaId: number;
  escrowAccount: string;
  signature: string;
}

/** Create a fresh on-chain arena as the service authority; returns the ids to persist. */
export async function provisionArena(entryFeeLamports: number): Promise<ProvisionedArena> {
  if (!onchainConfig.authoritySecret) {
    throw new Error("ARENA_AUTHORITY_SECRET is required to provision an on-chain arena");
  }
  const keypair = loadKeypair(onchainConfig.authoritySecret);
  const connection = new Connection(onchainConfig.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(ARENA_IDL as anchor.Idl, provider);

  const onchainArenaId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const arenaId = new anchor.BN(onchainArenaId);
  const { arena, escrow } = deriveArenaPdas(program.programId, arenaId);

  // Backend is both authority and payout_authority; platform fee 0 for MVP.
  // Loosely typed: the generated IDL types target a newer anchor than apps/api pins, but the
  // camelCase method + accounts resolve correctly at runtime from the IDL.
  const methods = program.methods as unknown as Record<
    string,
    (...args: unknown[]) => {
      accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
    }
  >;
  const signature = await methods
    .initArena!(arenaId, new anchor.BN(entryFeeLamports), keypair.publicKey, 0)
    .accounts({ arena, escrow, authority: keypair.publicKey })
    .rpc();

  return { onchainArenaId, escrowAccount: escrow.toBase58(), signature };
}
