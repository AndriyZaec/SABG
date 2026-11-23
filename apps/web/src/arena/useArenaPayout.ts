import { useCallback, useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEMO_ARENA_ID, deriveArenaPdas, onchainArenaState, useArenaProgram } from "../solana/program.js";

export interface ArenaPayoutOptions {
  onchainArenaId?: number;
}

type Status = "loading" | "idle" | "error";

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Transaction failed";

export interface PayoutState {
  ready: boolean;
  status: Status;
  error?: string;
  exists: boolean;
  prizePoolSol: number;
  settled: boolean;
  cancelled: boolean;
  settling: boolean;
  refresh: () => Promise<void>;
}

export function useArenaPayout(options: ArenaPayoutOptions = {}): PayoutState {
  const program = useArenaProgram();
  const { onchainArenaId } = options;
  const arenaId = useMemo(
    () => (onchainArenaId != null ? new BN(onchainArenaId) : DEMO_ARENA_ID),
    [onchainArenaId],
  );

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [exists, setExists] = useState(false);
  const [prizePoolSol, setPrizePoolSol] = useState(0);
  const [settled, setSettled] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [settling, setSettling] = useState(false);

  const refresh = useCallback(async (showLoading = true) => {
    if (!program) return;
    if (showLoading) setStatus("loading");
    if (showLoading) setError(undefined);
    try {
      const { arena } = deriveArenaPdas(program.programId, arenaId);
      const account = await program.account.arena.fetchNullable(arena);
      if (!account) {
        setExists(false);
        setPrizePoolSol(0);
        setSettled(false);
        setCancelled(false);
        setSettling(false);
      } else {
        const arenaState = onchainArenaState(account.state);
        setExists(true);
        setPrizePoolSol(Number(account.prizePoolLamports.toString()) / LAMPORTS_PER_SOL);
        setSettled(arenaState === "settled");
        setCancelled(arenaState === "cancelled");
        setSettling(arenaState === "settling");
      }
      if (showLoading) setStatus("idle");
    } catch (e) {
      if (showLoading) {
        setStatus("error");
        setError(errorMessage(e));
      }
    }
  }, [program, arenaId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    ready: program !== null,
    status,
    error,
    exists,
    prizePoolSol,
    settled,
    cancelled,
    settling,
    refresh,
  };
}
