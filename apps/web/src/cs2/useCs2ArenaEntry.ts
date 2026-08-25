import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  DEFAULT_ENTRY_FEE_LAMPORTS,
  deriveArenaPdas,
  deriveEntryPass,
  onchainArenaState,
  type OnchainArenaState,
  useArenaProgram,
} from "../solana/program.js";
import { prepareCs2Entry, submitCs2Entry } from "./api/cs2Client.js";
import { useAuth } from "../auth/AuthContext.js";

// Mirrors arena/useArenaEntry.ts — same on-chain program (solana/program.ts, reused unchanged),
// same one-signature backend-orchestrated join. No createArena/DEMO_ARENA_ID fallback: CS2 never
// has a "no backend arena at all" case (routing always supplies a real arenaId once a Series
// exists), so the standalone on-chain-demo path soccer's hook has doesn't apply here.

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

export interface Cs2ArenaInfo {
  exists: boolean;
  entryFeeSol: number;
  prizePoolSol: number;
  playerCount: number;
  state: OnchainArenaState;
}

export interface Cs2ArenaEntry {
  ready: boolean;
  status: Status;
  error?: string;
  info: Cs2ArenaInfo | null;
  hasEntry: boolean;
  entryRefunded: boolean;
  join: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface Cs2ArenaEntryOptions {
  onchainArenaId?: number;
  backendArenaId?: string;
}

const toSol = (lamports: { toString(): string }) => Number(lamports.toString()) / LAMPORTS_PER_SOL;

export function useCs2ArenaEntry(options: Cs2ArenaEntryOptions = {}): Cs2ArenaEntry {
  const program = useArenaProgram();
  const { publicKey, signTransaction } = useWallet();
  const { setSession } = useAuth();
  const { onchainArenaId, backendArenaId } = options;

  // null until the backend has provisioned the arena on-chain (ensureOnchain, lazy on first
  // prepare) — no pass can exist before that, so never report "joined".
  const targetArenaId = useMemo<BN | null>(() => (onchainArenaId != null ? new BN(onchainArenaId) : null), [onchainArenaId]);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<Cs2ArenaInfo | null>(null);
  const [hasEntry, setHasEntry] = useState(false);
  const [entryRefunded, setEntryRefunded] = useState(false);

  const refresh = useCallback(async (showLoading = true) => {
    if (!program) return;
    if (showLoading) setStatus("loading");
    if (showLoading) setError(undefined);
    try {
      if (targetArenaId === null) {
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
        const pass = await program.account.entryPass.fetchNullable(deriveEntryPass(program.programId, arena, publicKey));
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

  const join = useCallback(async () => {
    if (!publicKey || !signTransaction || !backendArenaId) return;
    await run(async () => {
      const wallet = publicKey.toBase58();
      const { prepareId, tx } = await prepareCs2Entry(backendArenaId, wallet);
      const signed = await signTransaction(Transaction.from(b64ToBytes(tx)));
      const res = await submitCs2Entry(backendArenaId, prepareId, bytesToB64(signed.serialize()));
      setSession(res.token, {
        id: res.player.userId,
        walletAddress: wallet,
        username: `fan_${wallet.slice(0, 6)}`,
      });
    });
  }, [publicKey, signTransaction, backendArenaId, run, setSession]);

  return { ready: program !== null, status, error, info, hasEntry, entryRefunded, join, refresh };
}
