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

  // Backend-provisioned id when available, else the standalone demo arena.
  const arenaId = useMemo(
    () => (onchainArenaId != null ? new BN(onchainArenaId) : DEMO_ARENA_ID),
    [onchainArenaId],
  );

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  const [hasEntry, setHasEntry] = useState(false);

  const refresh = useCallback(async () => {
    if (!program) return;
    setStatus("loading");
    setError(undefined);
    try {
      const { arena } = deriveArenaPdas(program.programId, arenaId);
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
  }, [program, publicKey, arenaId]);

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
    if (!program || !publicKey) return;
    await run(() =>
      program.methods
        .initArena(arenaId, DEFAULT_ENTRY_FEE_LAMPORTS, publicKey, 0)
        .accounts({ authority: publicKey })
        .rpc(),
    );
  }, [program, publicKey, arenaId, run]);

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
