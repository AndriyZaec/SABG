import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  DEFAULT_ENTRY_FEE_LAMPORTS,
  DEMO_ARENA_ID,
  deriveArenaPdas,
  deriveEntryPass,
  useArenaProgram,
} from "../solana/program.js";
import { prepareEntry, submitEntry } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";

/** Browser-safe base64 <-> bytes (no Node Buffer) for the wire transaction. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

type Status = "loading" | "idle" | "working" | "error";

export interface ArenaInfo {
  exists: boolean;
  entryFeeSol: number;
  prizePoolSol: number;
  playerCount: number;
  settled: boolean;
}

export interface ArenaEntry {
  ready: boolean;
  status: Status;
  error?: string;
  info: ArenaInfo | null;
  hasEntry: boolean;
  createArena: () => Promise<void>;
  join: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** When the backend has provisioned the arena, target its on-chain id and register entries with it. */
export interface ArenaEntryOptions {
  onchainArenaId?: number;
  backendArenaId?: string;
}

const toSol = (lamports: { toString(): string }) => Number(lamports.toString()) / LAMPORTS_PER_SOL;

/** Reads the target arena and lets the connected wallet create it (demo) / buy an entry. */
export function useArenaEntry(options: ArenaEntryOptions = {}): ArenaEntry {
  const program = useArenaProgram();
  const { publicKey, signTransaction } = useWallet();
  const { setSession } = useAuth();
  const { onchainArenaId, backendArenaId } = options;

  // Backend-provisioned id when this arena is on-chain; null when it's a real backend arena that
  // simply isn't on-chain yet (no pass is possible there — must not fall back to the demo arena's
  // PDA, or a wallet holding the standalone demo's pass would be reported as "joined" here); the
  // standalone demo arena only when there's no backend arena at all.
  const targetArenaId = useMemo<BN | null>(() => {
    if (onchainArenaId != null) return new BN(onchainArenaId);
    if (backendArenaId != null) return null;
    return DEMO_ARENA_ID;
  }, [onchainArenaId, backendArenaId]);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  const [hasEntry, setHasEntry] = useState(false);

  const refresh = useCallback(async () => {
    if (!program) return;
    setStatus("loading");
    setError(undefined);
    try {
      if (targetArenaId === null) {
        // Real backend arena, not provisioned on-chain yet — no pass can exist for it, so never
        // report "joined" here (see the DEMO_ARENA_ID fallback bug this guards against above).
        setInfo({ exists: false, entryFeeSol: toSol(DEFAULT_ENTRY_FEE_LAMPORTS), prizePoolSol: 0, playerCount: 0, settled: false });
        setHasEntry(false);
        setStatus("idle");
        return;
      }

      const { arena } = deriveArenaPdas(program.programId, targetArenaId);
      const account = await program.account.arena.fetchNullable(arena);
      setInfo(
        account
          ? {
              exists: true,
              entryFeeSol: toSol(account.entryFeeLamports),
              prizePoolSol: toSol(account.prizePoolLamports),
              playerCount: account.playerCount,
              settled: account.settled,
            }
          : { exists: false, entryFeeSol: toSol(DEFAULT_ENTRY_FEE_LAMPORTS), prizePoolSol: 0, playerCount: 0, settled: false },
      );

      if (publicKey) {
        const pass = await program.account.entryPass.fetchNullable(
          deriveEntryPass(program.programId, arena, publicKey),
        );
        setHasEntry(pass !== null);
      } else {
        setHasEntry(false);
      }
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to load arena");
    }
  }, [program, publicKey, targetArenaId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setStatus("working");
      setError(undefined);
      try {
        await action();
        await refresh();
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Transaction failed");
      }
    },
    [refresh],
  );

  const createArena = useCallback(async () => {
    if (!program || !publicKey || targetArenaId === null) return;
    await run(() =>
      program.methods
        .initArena(targetArenaId, DEFAULT_ENTRY_FEE_LAMPORTS, publicKey, 0)
        .accounts({ authority: publicKey })
        .rpc(),
    );
  }, [program, publicKey, targetArenaId, run]);

  // One-signature join: backend builds the buy_entry tx, the user signs it, backend submits + seats
  // + issues the session token. Payment and seat are one backend-owned act — no strand possible.
  const join = useCallback(async () => {
    if (!publicKey || !signTransaction || !backendArenaId) return;
    await run(async () => {
      const wallet = publicKey.toBase58();
      const { prepareId, tx } = await prepareEntry(backendArenaId, wallet);
      const signed = await signTransaction(Transaction.from(b64ToBytes(tx)));
      const res = await submitEntry(backendArenaId, prepareId, bytesToB64(signed.serialize()));
      setSession(res.token, {
        id: res.player.userId,
        walletAddress: wallet,
        username: `fan_${wallet.slice(0, 6)}`,
      });
    });
  }, [publicKey, signTransaction, backendArenaId, run, setSession]);

  return {
    ready: program !== null,
    status,
    error,
    info,
    hasEntry,
    createArena,
    join,
    refresh,
  };
}
