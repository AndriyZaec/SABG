import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEMO_ARENA_ID, deriveArenaPdas, useArenaProgram } from "../solana/program.js";

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
  isPayoutAuthority: boolean;
  settle: (winners: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Reads the demo arena's payout state and lets the payout authority settle it. */
export function useArenaPayout(): PayoutState {
  const program = useArenaProgram();
  const { publicKey } = useWallet();

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | undefined>();
  const [exists, setExists] = useState(false);
  const [prizePoolSol, setPrizePoolSol] = useState(0);
  const [settled, setSettled] = useState(false);
  const [isPayoutAuthority, setIsPayoutAuthority] = useState(false);

  const refresh = useCallback(async () => {
    if (!program) return;
    setStatus("loading");
    setError(undefined);
    try {
      const { arena } = deriveArenaPdas(program.programId, DEMO_ARENA_ID);
      const account = await program.account.arena.fetchNullable(arena);
      if (!account) {
        setExists(false);
        setPrizePoolSol(0);
        setSettled(false);
        setIsPayoutAuthority(false);
      } else {
        setExists(true);
        setPrizePoolSol(Number(account.prizePoolLamports.toString()) / LAMPORTS_PER_SOL);
        setSettled(account.settled);
        setIsPayoutAuthority(publicKey ? account.payoutAuthority.equals(publicKey) : false);
      }
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(errorMessage(e));
    }
  }, [program, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const settle = useCallback(
    async (winners: string[]) => {
      if (!program || !publicKey) return;
      setStatus("working");
      setError(undefined);
      try {
        const { arena, escrow } = deriveArenaPdas(program.programId, DEMO_ARENA_ID);
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
    [program, publicKey, refresh],
  );

  return {
    ready: program !== null,
    status,
    error,
    exists,
    prizePoolSol,
    settled,
    isPayoutAuthority,
    settle,
    refresh,
  };
}
