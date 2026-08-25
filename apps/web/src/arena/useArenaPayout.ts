import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEMO_ARENA_ID, deriveArenaPdas, onchainArenaState, useArenaProgram } from "../solana/program.js";

export interface ArenaPayoutOptions {
  onchainArenaId?: number;
}

type Status = "loading" | "idle" | "working" | "error";

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
  isPayoutAuthority: boolean;
  settle: (winners: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Reads the demo arena's payout state and lets the payout authority settle it. */
export function useArenaPayout(options: ArenaPayoutOptions = {}): PayoutState {
  const program = useArenaProgram();
  const { publicKey } = useWallet();
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
  const [isPayoutAuthority, setIsPayoutAuthority] = useState(false);

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
        setIsPayoutAuthority(false);
      } else {
        const arenaState = onchainArenaState(account.state);
        setExists(true);
        setPrizePoolSol(Number(account.prizePoolLamports.toString()) / LAMPORTS_PER_SOL);
        setSettled(arenaState === "settled");
        setCancelled(arenaState === "cancelled");
        setIsPayoutAuthority(publicKey ? account.payoutAuthority.equals(publicKey) : false);
      }
      if (showLoading) setStatus("idle");
    } catch (e) {
      if (showLoading) {
        setStatus("error");
        setError(errorMessage(e));
      }
    }
  }, [program, publicKey, arenaId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const settle = useCallback(
    async (winners: string[]) => {
      if (!program || !publicKey) return;
      setStatus("working");
      setError(undefined);
      try {
        const { arena, escrow } = deriveArenaPdas(program.programId, arenaId);
        const remainingAccounts = winners.map((w) => ({
          pubkey: new PublicKey(w),
          isWritable: true,
          isSigner: false,
        }));
        await program.methods
          .settlePayout()
          .accountsPartial({ arena, escrow, payoutAuthority: publicKey })
          .remainingAccounts(remainingAccounts)
          .rpc();
        await refresh();
      } catch (e) {
        setStatus("error");
        setError(errorMessage(e));
      }
    },
    [program, publicKey, arenaId, refresh],
  );

  return {
    ready: program !== null,
    status,
    error,
    exists,
    prizePoolSol,
    settled,
    cancelled,
    isPayoutAuthority,
    settle,
    refresh,
  };
}
