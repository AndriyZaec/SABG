// Pure row <-> @arena/contracts entity mappers. No I/O; unit-testable in isolation
// (db/__tests__/mappers.test.ts). Keeps the Drizzle row shape (snake_case columns, split
// scoreHome/scoreAway, Date objects) from leaking into the engines/gateway, which only ever see
// @arena/contracts entity shapes.

import type {
  Arena,
  ArenaPlayer,
  EntryPass,
  Match,
  Payout,
  Prediction,
  PredictionRound,
  SettlementCondition,
  User,
} from "@arena/contracts";
import type {
  arenaPlayers,
  arenas,
  entryPasses,
  matches,
  payouts,
  predictionRounds,
  predictions,
  users,
} from "./schema.js";

type UserRow = typeof users.$inferSelect;
type MatchRow = typeof matches.$inferSelect;
type ArenaRow = typeof arenas.$inferSelect;
type EntryPassRow = typeof entryPasses.$inferSelect;
type PredictionRoundRow = typeof predictionRounds.$inferSelect;
type ArenaPlayerRow = typeof arenaPlayers.$inferSelect;
type PredictionRow = typeof predictions.$inferSelect;
type PayoutRow = typeof payouts.$inferSelect;

export function userRowToEntity(row: UserRow): User {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    username: row.username,
    ...(row.avatar !== null ? { avatar: row.avatar } : {}),
  };
}

export function matchRowToEntity(row: MatchRow): Match {
  return {
    id: row.id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    startTime: row.startTime.toISOString(),
    status: row.status,
    currentMinute: row.currentMinute,
    period: row.period,
    score: { home: row.scoreHome, away: row.scoreAway },
  };
}

export function arenaRowToEntity(row: ArenaRow): Arena {
  return {
    id: row.id,
    matchId: row.matchId,
    status: row.status,
    activePlayersCount: row.activePlayersCount,
    entryFeeLamports: row.entryFeeLamports,
    prizePoolLamports: row.prizePoolLamports,
    escrowAccount: row.escrowAccount,
    ...(row.onchainArenaId != null ? { onchainArenaId: row.onchainArenaId } : {}),
  };
}

export function payoutRowToEntity(row: PayoutRow): Payout {
  return {
    id: row.id,
    arenaId: row.arenaId,
    userId: row.userId,
    amountLamports: row.amountLamports,
    ...(row.txSignature != null ? { txSignature: row.txSignature } : {}),
    status: row.status,
  };
}

export function entryPassRowToEntity(row: EntryPassRow): EntryPass {
  return {
    id: row.id,
    arenaId: row.arenaId,
    userId: row.userId,
    walletAddress: row.walletAddress,
    amountLamports: row.amountLamports,
    txSignature: row.txSignature,
    status: row.status,
    purchasedAt: row.purchasedAt.toISOString(),
  };
}

export function predictionRoundRowToEntity(row: PredictionRoundRow): PredictionRound {
  return {
    id: row.id,
    arenaId: row.arenaId,
    matchId: row.matchId,
    windowStartMinute: row.windowStartMinute,
    windowEndMinute: row.windowEndMinute,
    question: row.question,
    targetEventType: row.targetEventType,
    targetTeam: row.targetTeam,
    // jsonb column — the DAL is the only writer (prediction-round.repository.ts), so the shape
    // is trusted rather than re-validated on every read.
    settlementCondition: row.settlementCondition as SettlementCondition,
    status: row.status,
    ...(row.correctAnswer !== null ? { correctAnswer: row.correctAnswer } : {}),
    ...(row.openedAt !== null ? { openedAt: row.openedAt.toISOString() } : {}),
    ...(row.lockedAt !== null ? { lockedAt: row.lockedAt.toISOString() } : {}),
    ...(row.settledAt !== null ? { settledAt: row.settledAt.toISOString() } : {}),
    ...(row.settledBy !== null ? { settledBy: row.settledBy } : {}),
  };
}

export function arenaPlayerRowToEntity(row: ArenaPlayerRow): ArenaPlayer {
  return {
    id: row.id,
    arenaId: row.arenaId,
    userId: row.userId,
    status: row.status,
    score: row.score,
    joinedAt: row.joinedAt.toISOString(),
    ...(row.eliminatedRoundId !== null ? { eliminatedRoundId: row.eliminatedRoundId } : {}),
  };
}

export function predictionRowToEntity(row: PredictionRow): Prediction {
  return {
    id: row.id,
    roundId: row.roundId,
    userId: row.userId,
    answer: row.answer,
    answeredAt: row.answeredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    ...(row.result !== null ? { result: row.result } : {}),
  };
}
