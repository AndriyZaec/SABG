import { useMemo } from "react";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ARENA_IDL } from "@arena/contracts/onchain";
import type { ArenaProgram } from "@arena/contracts/onchain";

/** Single shared demo arena + fee for the devnet demo (no backend to list arenas yet). */
export const DEMO_ARENA_ID = new BN(1);
export const DEFAULT_ENTRY_FEE_LAMPORTS = new BN(0.1 * LAMPORTS_PER_SOL);

/** Anchor program bound to the connected wallet, or null until a wallet connects. */
export function useArenaProgram(): Program<ArenaProgram> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return new Program<ArenaProgram>(ARENA_IDL, provider);
  }, [connection, wallet]);
}

export function deriveArenaPdas(programId: PublicKey, arenaId: BN) {
  const [arena] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), arena.toBuffer()],
    programId,
  );
  return { arena, escrow };
}

export function deriveEntryPass(programId: PublicKey, arena: PublicKey, player: PublicKey) {
  const [entryPass] = PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), arena.toBuffer(), player.toBuffer()],
    programId,
  );
  return entryPass;
}
