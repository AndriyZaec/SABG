import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { assertPlatformFeeBps, buildProgram, buildSettlementAccounts, decodeArenaState, deriveArenaPdas, deriveSettlement } from "../onchain/arena-program.js";
import type { ArenaChainState } from "../onchain/arena-program.js";
import { logger } from "../gateway/logger.js";

export const PAYOUT_BATCH_SIZE = 20;
export class PayoutBlocked extends Error {}

export type PayoutStep = { step: "start"; count: number } | { step: "pay"; from: number; wallets: string[] } | { step: "close" };
export interface SignedAttempt {
  signature: string;
  raw: string;
  lastValidBlockHeight: number;
}
export type AttemptStatus = "pending" | "expired" | "failed" | { kind: "verified"; skipped: number[] };
export interface SettlementSnapshot {
  state: ArenaChainState;
  pool: bigint;
  feeBps: number;
  playerCount: number;
  settlement: null | { paidCount: number; winnerCount: number; share: bigint; lastPaidKey: string };
}

export function payoutChain(id: number) {
  const { program, authority } = buildProgram();
  const connection = program.provider.connection;
  const { arena, escrow } = deriveArenaPdas(program.programId, new anchor.BN(id));
  const settlement = deriveSettlement(program.programId, arena);
  const accounts = buildSettlementAccounts(arena, escrow, authority.publicKey);
  const treasury = accounts["treasury"]!;
  const events = new anchor.EventParser(program.programId, program.coder);
  let verifiedSlot = 0;

  async function transaction(intent: PayoutStep): Promise<Transaction> {
    switch (intent.step) {
      case "start": return program.methods.startSettlement(intent.count)
        .accountsPartial({ arena, escrow, settlement, treasury, payoutAuthority: authority.publicKey }).transaction();
      case "pay": return program.methods.payBatch(intent.from)
        .accountsPartial({ arena, escrow, settlement, treasury, payoutAuthority: authority.publicKey })
        .remainingAccounts(intent.wallets.map((wallet) => ({ pubkey: new PublicKey(wallet), isWritable: true, isSigner: false })))
        .transaction();
      case "close": return program.methods.closeSettlement()
        .accountsPartial({ arena, settlement, funder: authority.publicKey, payoutAuthority: authority.publicKey }).transaction();
    }
  }

  return {
    async read(): Promise<SettlementSnapshot> {
      const [arenaInfo, settlementInfo] = await connection.getMultipleAccountsInfo([arena, settlement], {
        commitment: "finalized", minContextSlot: verifiedSlot,
      });
      if (!arenaInfo?.owner.equals(program.programId)) throw new PayoutBlocked(`Invalid on-chain arena ${id}`);
      const a = program.coder.accounts.decode("arena", arenaInfo.data) as Awaited<ReturnType<typeof program.account.arena.fetch>>;
      if (!a.payoutAuthority.equals(authority.publicKey)) throw new PayoutBlocked("Unexpected payout authority");
      assertPlatformFeeBps(a.platformFeeBps, id);
      if (settlementInfo && !settlementInfo.owner.equals(program.programId)) throw new PayoutBlocked("Invalid Settlement owner");
      const s = settlementInfo ? program.coder.accounts.decode("settlement", settlementInfo.data) as
        Awaited<ReturnType<typeof program.account.settlement.fetch>> : null;
      if (s && (!s.arena.equals(arena) || !s.funder.equals(authority.publicKey))) throw new PayoutBlocked("Invalid Settlement configuration");
      return { state: decodeArenaState(a.state), pool: BigInt(a.prizePoolLamports.toString()), feeBps: a.platformFeeBps,
        playerCount: a.playerCount, settlement: s ? { paidCount: s.paidCount, winnerCount: s.winnerCount,
          share: BigInt(s.share.toString()), lastPaidKey: s.lastPaidKey.toBase58() } : null };
    },
    async preflight(wallets: string[], share: bigint, pool: bigint) {
      const reserved = [arena, escrow, settlement, treasury, program.programId, SystemProgram.programId];
      const keys = wallets.map((wallet) => new PublicKey(wallet));
      const rentBySize = new Map<number, bigint>();
      const minimum = async (size: number) => {
        const cached = rentBySize.get(size);
        if (cached !== undefined) return cached;
        const balance = BigInt(await connection.getMinimumBalanceForRentExemption(size, "finalized"));
        rentBySize.set(size, balance);
        return balance;
      };
      const min = await minimum(0);
      if (share < min && keys.length > PAYOUT_BATCH_SIZE) throw new PayoutBlocked("Small shares do not fit one atomic batch");
      const [escrowInfo, treasuryInfo] = await connection.getMultipleAccountsInfo([escrow, treasury], "finalized");
      if (!escrowInfo?.owner.equals(SystemProgram.programId) || escrowInfo.data.length !== 0 || BigInt(escrowInfo.lamports) < pool) {
        throw new PayoutBlocked("Escrow cannot fund the recorded prize pool");
      }
      let credited = 0n;
      for (let at = 0; at < keys.length; at += 100) {
        const slice = keys.slice(at, at + 100);
        const infos = await connection.getMultipleAccountsInfo(slice, "finalized");
        for (const [i, key] of slice.entries()) {
          const info = infos[i];
          const wallet = key.toBase58();
          if (reserved.some((p) => p.equals(key))) throw new PayoutBlocked(`Reserved payout wallet ${wallet}`);
          const balance = BigInt(info?.lamports ?? 0) + share;
          if (info?.executable || balance > 0xffff_ffff_ffff_ffffn || balance < await minimum(info?.data.length ?? 0)) {
            if (share < min) throw new PayoutBlocked(`Ineligible payout wallet ${wallet}`);
            logger.warn({ onchainArenaId: id, wallet, index: at + i }, "Payout preflight predicts a skipped winner");
          } else {
            credited += share;
          }
        }
      }
      const treasuryCredit = BigInt(escrowInfo.lamports) - credited;
      if ((treasuryInfo && (!treasuryInfo.owner.equals(SystemProgram.programId) || treasuryInfo.executable)) ||
        (treasuryCredit > 0n && BigInt(treasuryInfo?.lamports ?? 0) + treasuryCredit < await minimum(treasuryInfo?.data.length ?? 0))) {
        throw new PayoutBlocked("Treasury cannot receive the remainder");
      }
    },
    async prepare(intent: PayoutStep): Promise<SignedAttempt> {
      const tx = await transaction(intent);
      const latest = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = latest.blockhash;
      tx.sign(authority);
      if (!tx.signature) throw new Error("Payout signing failed");
      return { signature: bs58.encode(tx.signature), raw: tx.serialize().toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight };
    },
    async status(attempt: SignedAttempt, intent: PayoutStep): Promise<AttemptStatus> {
      const signed = Transaction.from(Buffer.from(attempt.raw, "base64"));
      const expected = await transaction(intent);
      expected.feePayer = authority.publicKey;
      expected.recentBlockhash = signed.recentBlockhash!;
      if (!signed.signature || bs58.encode(signed.signature) !== attempt.signature ||
        !signed.serializeMessage().equals(expected.serializeMessage())) throw new PayoutBlocked("Persisted transaction differs from payout plan");
      const seen = await connection.getTransaction(attempt.signature, { commitment: "finalized" });
      if (seen) {
        if (!seen.meta || !Buffer.from(seen.transaction.message.serialize()).equals(signed.serializeMessage())) {
          throw new PayoutBlocked("Finalized transaction differs from payout plan");
        }
        if (seen.meta.err !== null) return "failed";
        const skipped = new Set<number>();
        if (intent.step === "pay") {
          let complete = false;
          for (const event of events.parseLogs(seen.meta.logMessages ?? [])) {
            if (event.name === "winnerSkipped") {
              const { arena: eventArena, index, winner } = event.data;
              if (complete || !eventArena.equals(arena) || intent.wallets[index - intent.from] !== winner.toBase58() || skipped.has(index)) {
                throw new PayoutBlocked("Finalized skip event differs from payout plan");
              }
              skipped.add(index);
            } else if (event.name === "winnerBatchPaid") {
              const { arena: eventArena, from, count } = event.data;
              if (complete || !eventArena.equals(arena) || from !== intent.from || count !== intent.wallets.length) {
                throw new PayoutBlocked("Finalized batch event differs from payout plan");
              }
              complete = true;
            }
          }
          // This marker follows all skips. Don't infer that everyone was paid from truncated logs.
          if (!complete) throw new Error("Finalized batch event is unavailable");
        }
        verifiedSlot = Math.max(verifiedSlot, seen.slot);
        return { kind: "verified", skipped: [...skipped] };
      }
      return await connection.getBlockHeight("finalized") > attempt.lastValidBlockHeight ? "expired" : "pending";
    },
    async broadcast(attempt: SignedAttempt) {
      // Any transport error is ambiguous; the persisted signature will be checked on retry.
      await connection.sendRawTransaction(Buffer.from(attempt.raw, "base64"), { preflightCommitment: "confirmed" });
    },
  };
}

export type PayoutChain = ReturnType<typeof payoutChain>;
