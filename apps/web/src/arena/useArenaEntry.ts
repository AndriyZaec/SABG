import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  DEFAULT_ENTRY_FEE_LAMPORTS,
  DEMO_ARENA_ID,
  deriveArenaPdas,
  deriveEntryPass,
  onchainArenaState,
  type OnchainArenaState,
  useArenaProgram,
} from "../solana/program.js";
import { prepareEntry, submitEntry } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";

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
  state: OnchainArenaState;
}

export interface ArenaEntry {
  ready: boolean;
  status: Status;
  error?: string;
  info: ArenaInfo | null;
  hasEntry: boolean;
  entryRefunded: boolean;
  createArena: () => Promise<void>;
  join: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface ArenaEntryOptions {
  onchainArenaId?: number;
  backendArenaId?: string;
}

const toSol = (lamports: { toString(): string }) => Number(lamports.toString()) / LAMPORTS_PER_SOL;

export function useArenaEntry(options: ArenaEntryOptions = {}): ArenaEntry {
  const program = useArenaProgram();
  const { publicKey, signTransaction } = useWallet();
  const { setSession } = useAuth();
  const { onchainArenaId, backendArenaId } = options;

  // Never use the demo PDA for a backend arena that is not yet provisioned on-chain.
  const targetArenaId = useMemo<BN | null>(() => {
    if (onchainArenaId != null) return new BN(onchainArenaId);
    if (backendArenaId != null) return null;
    return DEMO_ARENA_ID;
  }, [onchainArenaId, backendArenaId]);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  const [hasEntry, setHasEntry] = useState(false);
  const [entryRefunded, setEntryRefunded] = useState(false);

  const refresh = useCallback(async (showLoading = true) => {
    if (!program) return;
    if (showLoading) setStatus("loading");
    if (showLoading) setError(undefined);
    try {
      if (targetArenaId === null) {
        // An unprovisioned arena cannot have an entry pass.
        setInfo({ exists: false, entryFeeSol: toSol(DEFAULT_ENTRY_FEE_LAMPORTS), prizePoolSol: 0, playerCount: 0, state: "open" });
        setHasEntry(false);
        setEntryRefunded(false);
        if (showLoading) setStatus("idle");
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
              state: onchainArenaState(account.state),
            }
          : { exists: false, entryFeeSol: toSol(DEFAULT_ENTRY_FEE_LAMPORTS), prizePoolSol: 0, playerCount: 0, state: "open" },
      );

      if (publicKey) {
        const pass = await program.account.entryPass.fetchNullable(
          deriveEntryPass(program.programId, arena, publicKey),
        );
        setHasEntry(pass !== null && !pass.refunded);
        setEntryRefunded(pass?.refunded ?? false);
      } else {
        setHasEntry(false);
        setEntryRefunded(false);
      }
      if (showLoading) setStatus("idle");
    } catch (e) {
      if (showLoading) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Failed to load arena");
      }
    }
  }, [program, publicKey, targetArenaId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
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
    entryRefunded,
    createArena,
    join,
    refresh,
  };
}
