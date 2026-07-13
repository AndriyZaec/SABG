import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DEFAULT_ENTRY_FEE_LAMPORTS,
  DEMO_ARENA_ID,
  deriveArenaPdas,
  deriveEntryPass,
  useArenaProgram,
} from "../solana/program.js";
import { registerEntry } from "../api/client.js";

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
  buyEntry: () => Promise<void>;
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
  const { publicKey } = useWallet();
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

  const buyEntry = useCallback(async () => {
    if (!program || !publicKey) return;
    const { arena } = deriveArenaPdas(program.programId, arenaId);
    await run(async () => {
      const signature = await program.methods
        .buyEntry()
        .accountsPartial({ arena, player: publicKey })
        .rpc();
      // Register the entry with the backend so the player joins the arena game.
      if (backendArenaId) await registerEntry(backendArenaId, signature);
    });
  }, [program, publicKey, arenaId, backendArenaId, run]);

  return {
    ready: program !== null,
    status,
    error,
    info,
    hasEntry,
    createArena,
    buyEntry,
    refresh,
  };
}
