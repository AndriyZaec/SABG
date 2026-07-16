// On-chain arena provisioning: the backend acts as the arena `authority` + `payout_authority`,
// creating the arena via the deployed program. Loaded only when provisioning is enabled.
//
// Default import, not `* as anchor`: under this project's ESM runtime (tsx), a namespace import
// of @coral-xyz/anchor's CJS build does not expose `anchor.BN` as a constructor (Program/
// AnchorProvider/Wallet resolve fine, BN alone doesn't) — found by actually exercising this path
// against devnet for the first time (it had only ever run with ONCHAIN_ARENAS_ENABLED=false
// before). The default import exposes all four correctly.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
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
  transaction: () => Promise<Transaction>;
};
type LooseMethods = Record<string, (...args: unknown[]) => RpcBuilder>;

/** entry_pass PDA — same seeds as the program & frontend (deriveEntryPass). */
function deriveEntryPass(programId: PublicKey, arena: PublicKey, player: PublicKey): PublicKey {
  const [entryPass] = PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), arena.toBuffer(), player.toBuffer()],
    programId,
  );
  return entryPass;
}

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

/**
 * Build an unsigned `buy_entry` tx for the user to sign. The user (`player`) is the sole signer
 * and fee payer — the backend never signs it, only submits it (submitSignedEntry). Returns the
 * base64 wire tx; the caller stashes it and hands it to the browser to sign.
 */
export async function buildBuyEntryTx(onchainArenaId: number, playerAddress: string): Promise<string> {
  const { program } = buildProgram();
  const player = new PublicKey(playerAddress);
  const { arena, escrow } = deriveArenaPdas(program.programId, new anchor.BN(onchainArenaId));
  const entryPass = deriveEntryPass(program.programId, arena, player);

  const tx = await (program.methods as unknown as LooseMethods)
    .buyEntry!()
    .accounts({ arena, entryPass, escrow, player })
    .transaction();

  tx.feePayer = player;
  const { blockhash } = await program.provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return tx.serialize({ requireAllSignatures: false }).toString("base64");
}

/** Submit a user-signed `buy_entry` tx and wait for confirmation; returns the signature. */
export async function submitSignedEntry(signedTxBase64: string): Promise<string> {
  const { program } = buildProgram();
  const connection = program.provider.connection;
  const raw = Buffer.from(signedTxBase64, "base64");
  const signature = await connection.sendRawTransaction(raw);
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
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
