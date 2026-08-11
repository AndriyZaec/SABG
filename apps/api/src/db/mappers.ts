// Pure row <-> @arena/contracts entity mappers. No I/O; unit-testable in isolation
// (db/__tests__/mappers.test.ts). Keeps the Drizzle row shape (snake_case columns, split
// scoreHome/scoreAway, Date objects) from leaking into the engines/gateway, which only ever see
// @arena/contracts entity shapes.

import type {
  Arena,
  ArenaCancelledReason,
  ArenaPlayer,
  EntryPass,
  Match,
  Payout,
  Prediction,
  PredictionRound,
  Series,
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
  series,
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
type SeriesRow = typeof series.$inferSelect;

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
    discipline: row.discipline,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    startTime: row.startTime.toISOString(),
    status: row.status,
    currentMinute: row.currentMinute,
    period: row.period,
    score: { home: row.scoreHome, away: row.scoreAway },
    ...(row.seriesId !== null ? { seriesId: row.seriesId } : {}),
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
    // Plain text column (not a pg-enum, see schema.ts) — the DAL is the only writer
    // (arena.repository.ts's cancelIfLobby), so the value is trusted rather than re-validated.
    ...(row.cancelledReason !== null ? { cancelledReason: row.cancelledReason as ArenaCancelledReason } : {}),
  };
}

export function seriesRowToEntity(row: SeriesRow): Series {
  return {
    id: row.id,
    gridSeriesId: row.gridSeriesId,
    format: row.format,
    scheduledStartTime: row.scheduledStartTime.toISOString(),
    status: row.status,
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
    discipline: row.discipline,
    question: row.question,
    // jsonb column — the DAL is the only writer (prediction-round.repository.ts), so the shape
    // is trusted rather than re-validated on every read.
    settlementCondition: row.settlementCondition as SettlementCondition,
    status: row.status,
    ...(row.windowStartMinute !== null ? { windowStartMinute: row.windowStartMinute } : {}),
    ...(row.windowEndMinute !== null ? { windowEndMinute: row.windowEndMinute } : {}),
    ...(row.roundNumber !== null ? { roundNumber: row.roundNumber } : {}),
    ...(row.targetEventType !== null ? { targetEventType: row.targetEventType } : {}),
    ...(row.targetTeam !== null ? { targetTeam: row.targetTeam } : {}),
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
