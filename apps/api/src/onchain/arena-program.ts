// On-chain arena provisioning: the backend acts as the arena `authority` + `payout_authority`,
// creating the arena via the deployed program. Loaded only when provisioning is enabled.
//
// Default import, not `* as anchor`: under this project's ESM runtime (tsx), a namespace import
// of @coral-xyz/anchor's CJS build does not expose `anchor.BN` as a constructor (Program/
// AnchorProvider/Wallet resolve fine, BN alone doesn't) — found by actually exercising this path
// against devnet for the first time (it had only ever run with ONCHAIN_ARENAS_ENABLED=false
// before). The default import exposes all four correctly.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { createHmac } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
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

const ARENA_ACCOUNT_SPACE = 137;
const TRANSACTION_FEE_HEADROOM_LAMPORTS = 10_000;

export function assertAuthorityCanProvision(
  balanceLamports: number,
  arenaRentLamports: number,
  reserveLamports: number,
): void {
  const requiredLamports = arenaRentLamports + TRANSACTION_FEE_HEADROOM_LAMPORTS + reserveLamports;
  if (balanceLamports < requiredLamports) {
    throw new Error(
      `Arena authority balance ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL is below the required ${(requiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (arena rent + fee headroom + reserve)`,
    );
  }
}

export function assertEscrowEmpty(balanceLamports: number, onchainArenaId: number): void {
  if (balanceLamports > 0) {
    throw new Error(
      `Refusing to recycle on-chain arena ${onchainArenaId}: escrow still holds ${balanceLamports} lamports`,
    );
  }
}

export function assertArenaRecyclableState(
  settled: boolean,
  escrowBalanceLamports: number,
  onchainArenaId: number,
): void {
  if (!settled) {
    throw new Error(`Refusing to recycle on-chain arena ${onchainArenaId}: arena is not settled`);
  }
  assertEscrowEmpty(escrowBalanceLamports, onchainArenaId);
}

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
  signature?: string;
}

/** Stable 52-bit seed lets a retry recover the same PDA after Solana succeeds but DB commit fails. */
export function deriveOnchainArenaId(databaseArenaId: string, authoritySecretKey: Uint8Array): number {
  const compact = databaseArenaId.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error(`Invalid database arena UUID: ${databaseArenaId}`);
  const digest = createHmac("sha256", authoritySecretKey).update(compact).digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16);
}

/** Create or recover an on-chain arena as the service authority; returns the ids to persist. */
export async function provisionArena(
  entryFeeLamports: number,
  databaseArenaId: string,
): Promise<ProvisionedArena> {
  const { program, authority } = buildProgram();
  const onchainArenaId = deriveOnchainArenaId(databaseArenaId, authority.secretKey);
  const connection = program.provider.connection;
  const arenaId = new anchor.BN(onchainArenaId);
  const { arena, escrow } = deriveArenaPdas(program.programId, arenaId);
  const existing = await connection.getAccountInfo(arena, "confirmed");
  if (existing) {
    const decoded = program.coder.accounts.decode("Arena", existing.data) as {
      authority: PublicKey;
      entryFeeLamports: anchor.BN;
    };
    if (!decoded.authority.equals(authority.publicKey) || !decoded.entryFeeLamports.eq(new anchor.BN(entryFeeLamports))) {
      throw new Error(`On-chain arena ${onchainArenaId} exists with unexpected authority or entry fee`);
    }
    return { onchainArenaId, escrowAccount: escrow.toBase58() };
  }

  const [balanceLamports, arenaRentLamports] = await Promise.all([
    connection.getBalance(authority.publicKey, "confirmed"),
    connection.getMinimumBalanceForRentExemption(ARENA_ACCOUNT_SPACE, "confirmed"),
  ]);
  assertAuthorityCanProvision(
    balanceLamports,
    arenaRentLamports,
    onchainConfig.authorityReserveLamports,
  );

  // Backend is both authority and payout_authority; platform fee 0 for MVP.
  const signature = await (program.methods as unknown as LooseMethods)
    .initArena!(arenaId, new anchor.BN(entryFeeLamports), authority.publicKey, 0)
    .accounts({ arena, escrow, authority: authority.publicKey })
    .rpc();

  return { onchainArenaId, escrowAccount: escrow.toBase58(), signature };
}

export type PreparedEntryVerification =
  | { ok: true; blockhashRefreshed: boolean }
  | {
      ok: false;
      reason:
        | "invalid_transaction"
        | "unexpected_signers"
        | "message_changed"
        | "wallet_signature_missing"
        | "wallet_signature_invalid";
    };

export function verifyPreparedEntryTransaction(
  preparedTxBase64: string,
  signedTxBase64: string,
  walletAddress: string,
): PreparedEntryVerification {
  try {
    const prepared = Transaction.from(Buffer.from(preparedTxBase64, "base64"));
    const signed = Transaction.from(Buffer.from(signedTxBase64, "base64"));
    const wallet = new PublicKey(walletAddress);
    const preparedMessage = prepared.compileMessage();
    const signedMessage = signed.compileMessage();
    if (
      preparedMessage.header.numRequiredSignatures !== 1 ||
      !preparedMessage.accountKeys[0]?.equals(wallet)
    ) {
      return { ok: false, reason: "unexpected_signers" };
    }
    if (!sameEntryMessageStructure(preparedMessage, signedMessage)) {
      return { ok: false, reason: "message_changed" };
    }
    const walletSignature = signed.signatures.find(({ publicKey }) => publicKey.equals(wallet))?.signature;
    if (walletSignature == null) return { ok: false, reason: "wallet_signature_missing" };
    if (!nacl.sign.detached.verify(signed.serializeMessage(), walletSignature, wallet.toBytes())) {
      return { ok: false, reason: "wallet_signature_invalid" };
    }
    return {
      ok: true,
      blockhashRefreshed: preparedMessage.recentBlockhash !== signedMessage.recentBlockhash,
    };
  } catch {
    return { ok: false, reason: "invalid_transaction" };
  }
}

function sameEntryMessageStructure(
  prepared: ReturnType<Transaction["compileMessage"]>,
  signed: ReturnType<Transaction["compileMessage"]>,
): boolean {
  if (
    prepared.header.numRequiredSignatures !== signed.header.numRequiredSignatures ||
    prepared.header.numReadonlySignedAccounts !== signed.header.numReadonlySignedAccounts ||
    prepared.header.numReadonlyUnsignedAccounts !== signed.header.numReadonlyUnsignedAccounts ||
    prepared.accountKeys.length !== signed.accountKeys.length ||
    prepared.instructions.length !== signed.instructions.length
  ) {
    return false;
  }
  if (!prepared.accountKeys.every((key, index) => key.equals(signed.accountKeys[index]!))) return false;
  return prepared.instructions.every((instruction, index) => {
    const candidate = signed.instructions[index];
    return candidate !== undefined &&
      instruction.programIdIndex === candidate.programIdIndex &&
      instruction.data === candidate.data &&
      instruction.accounts.length === candidate.accounts.length &&
      instruction.accounts.every((account, accountIndex) => account === candidate.accounts[accountIndex]);
  });
}

/** Auto-cycle must never delete DB references while player funds remain in the old escrow. */
export async function assertArenaRecyclable(onchainArenaId: number): Promise<void> {
  const { program } = buildProgram();
  const { arena, escrow } = deriveArenaPdas(program.programId, new anchor.BN(onchainArenaId));
  const [arenaAccount, balanceLamports] = await Promise.all([
    program.provider.connection.getAccountInfo(arena, "finalized"),
    program.provider.connection.getBalance(escrow, "finalized"),
  ]);
  if (!arenaAccount) throw new Error(`On-chain arena ${onchainArenaId} does not exist`);
  const decoded = program.coder.accounts.decode("Arena", arenaAccount.data) as { settled: boolean };
  assertArenaRecyclableState(decoded.settled, balanceLamports, onchainArenaId);
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
