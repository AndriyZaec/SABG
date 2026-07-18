// Shared scripted-bot helpers: seed bots into an arena through the real DB-backed entry flow,
// and wrap a broadcaster so those bots actually answer each round. Used by replay tooling
// (gateway/run.ts) and the live worker (live/run.ts) so the join/answer logic lives in one place.
//
// Bots are DB-only: a real users row + entry_pass + active-player/prize-pool bumps + runtime.join,
// but no on-chain buy_entry (their wallet is a stub, not a real pubkey). The on-chain money-shot
// therefore relies on the human being the winner; payout filters out non-pubkey (bot) winners.

import type { Answer, PredictionRound, ServerMessage, Uuid } from "@arena/contracts";
import type { ArenaRuntime, GatewayBroadcaster } from "./arena-runtime.js";
import { userRepository } from "../db/repositories/user.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { createBots } from "../replay/bots.js";

export interface ScriptedBot {
  userId: Uuid;
  answerFor(round: PredictionRound): Answer;
}

function botWallet(index: number): string {
  return `scripted-bot-wallet-${index}`;
}

/**
 * Joins `count` scripted bots through the real entry flow — a users row (wallet upsert), an
 * entry_pass row, the arena's active-player + prize-pool counters, then `runtime.join(...)` (what
 * POST /arenas/:id/entry calls) — while the arena is still `lobby` (pre-kickoff only).
 * Idempotent across restarts: `upsertByWallet` returns the same user, and the entry-pass/counter
 * writes are skipped once that bot has already entered this arena.
 */
export async function joinBots(
  arenaId: Uuid,
  runtime: ArenaRuntime,
  count: number,
  entryFeeLamports: number,
): Promise<ScriptedBot[]> {
  const scripted = createBots(count);
  const bots: ScriptedBot[] = [];

  for (const [index, bot] of scripted.entries()) {
    const user = await userRepository.upsertByWallet(botWallet(index), bot.username);

    const alreadyEntered = await entryPassRepository.findByArenaAndUser(arenaId, user.id);
    if (alreadyEntered === undefined) {
      await entryPassRepository.create({
        arenaId,
        userId: user.id,
        walletAddress: user.walletAddress,
        amountLamports: entryFeeLamports,
        txSignature: `scripted-bot-${index}`,
      });
      await arenaRepository.bumpActivePlayers(arenaId, 1);
      await arenaRepository.bumpPrizePool(arenaId, entryFeeLamports);
    }

    runtime.join(user.id, user.username, new Date().toISOString());
    bots.push({ userId: user.id, answerFor: bot.answerFor });
  }

  return bots;
}

/**
 * Wrap a broadcaster so every still-active bot answers immediately on `round.open` — the piece that
 * makes bots actually play rather than just sit on the roster. Bots and the runtime are read via
 * getters to sidestep the runtime↔broadcaster construction cycle (the runtime needs the broadcaster
 * in its constructor, and this wrapper needs the runtime to submit answers).
 */
export function withBotAnswers(
  inner: GatewayBroadcaster,
  ctx: {
    getBots: () => ScriptedBot[];
    getRuntime: () => ArenaRuntime;
    isActive: (userId: Uuid) => boolean;
  },
): GatewayBroadcaster {
  return {
    broadcast(arenaId: Uuid, message: ServerMessage) {
      inner.broadcast(arenaId, message);
      if (message.type !== "round.open") return;
      const round = message.round;
      for (const bot of ctx.getBots()) {
        if (!ctx.isActive(bot.userId)) continue;
        ctx.getRuntime().submitAnswer(bot.userId, round.id, bot.answerFor(round));
      }
    },
    sendToUser(arenaId: Uuid, userId: Uuid, message: ServerMessage) {
      inner.sendToUser(arenaId, userId, message);
    },
  };
}
