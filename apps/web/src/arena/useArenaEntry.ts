import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DEFAULT_ENTRY_FEE_LAMPORTS,
  DEMO_ARENA_ID,
  deriveArenaPdas,
  deriveEntryPass,
  useArenaProgram,
} from "../solana/program.js";

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

const toSol = (lamports: { toString(): string }) => Number(lamports.toString()) / LAMPORTS_PER_SOL;

/** Reads the shared demo arena and lets the connected wallet create it / buy an entry. */
export function useArenaEntry(): ArenaEntry {
  const program = useArenaProgram();
  const { publicKey } = useWallet();

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  const [hasEntry, setHasEntry] = useState(false);

  const refresh = useCallback(async () => {
    if (!program) return;
    setStatus("loading");
    setError(undefined);
    try {
      const { arena } = deriveArenaPdas(program.programId, DEMO_ARENA_ID);
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
  }, [program, publicKey]);

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
        .initArena(DEMO_ARENA_ID, DEFAULT_ENTRY_FEE_LAMPORTS, publicKey, 0)
        .accounts({ authority: publicKey })
        .rpc(),
    );
  }, [program, publicKey, run]);

  const buyEntry = useCallback(async () => {
    if (!program || !publicKey) return;
    const { arena } = deriveArenaPdas(program.programId, DEMO_ARENA_ID);
    await run(() =>
      program.methods.buyEntry().accounts({ arena, player: publicKey }).rpc(),
    );
  }, [program, publicKey, run]);

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
