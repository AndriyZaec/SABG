// Postgres schema for spec v2 §13 Data Models.
// Persisted entities only — MatchState / LeaderboardEntry are in-memory engine
// aggregates, not tables. Enum values are derived from @arena/contracts
// so the DB stays in lockstep with that shared-type source of truth.

import {
  ANSWERS,
  ARENA_PLAYER_STATUSES,
  ARENA_STATUSES,
  ENTRY_PASS_STATUSES,
  MATCH_PERIODS,
  MATCH_STATUSES,
  PAYOUT_STATUSES,
  PREDICTION_RESULTS,
  ROUND_STATUSES,
  SETTLED_BY_VALUES,
  TARGET_EVENT_TYPES,
  TEAM_SIDES,
} from "@arena/contracts";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const matchStatusEnum = pgEnum("match_status", MATCH_STATUSES);
export const matchPeriodEnum = pgEnum("match_period", MATCH_PERIODS);
export const arenaStatusEnum = pgEnum("arena_status", ARENA_STATUSES);
export const arenaPlayerStatusEnum = pgEnum("arena_player_status", ARENA_PLAYER_STATUSES);
export const entryPassStatusEnum = pgEnum("entry_pass_status", ENTRY_PASS_STATUSES);
export const roundStatusEnum = pgEnum("round_status", ROUND_STATUSES);
export const settledByEnum = pgEnum("settled_by", SETTLED_BY_VALUES);
export const answerEnum = pgEnum("answer", ANSWERS);
export const predictionResultEnum = pgEnum("prediction_result", PREDICTION_RESULTS);
export const payoutStatusEnum = pgEnum("payout_status", PAYOUT_STATUSES);
export const targetEventTypeEnum = pgEnum("target_event_type", TARGET_EVENT_TYPES);
export const teamSideEnum = pgEnum("team_side", TEAM_SIDES);

/**
 * Audit columns for every table. `updatedAt` is kept current by the
 * `set_updated_at` trigger (see migrations), not by application code.
 */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  ...timestamps,
}, (t) => [
  uniqueIndex("user_wallet_address_idx").on(t.walletAddress),
]);

export const matches = pgTable("match", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** TXODDS numeric fixture id — the join key to the /scores/stream feed. */
  txoddsFixtureId: integer("txodds_fixture_id").unique(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  status: matchStatusEnum("status").notNull(),
  currentMinute: integer("current_minute").notNull(),
  period: matchPeriodEnum("period").notNull(),
  scoreHome: integer("score_home").notNull(),
  scoreAway: integer("score_away").notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("match_teams_start_time_idx").on(t.homeTeam, t.awayTeam, t.startTime),
]);

export const arenas = pgTable("arena", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  status: arenaStatusEnum("status").notNull(),
  activePlayersCount: integer("active_players_count").notNull(),
  entryFeeLamports: bigint("entry_fee_lamports", { mode: "number" }).notNull(),
  prizePoolLamports: bigint("prize_pool_lamports", { mode: "number" }).notNull(),
  escrowAccount: text("escrow_account").notNull(),
  /** On-chain program `arena_id` PDA seed. Null until the arena is provisioned on-chain. */
  onchainArenaId: bigint("onchain_arena_id", { mode: "number" }),
  ...timestamps,
}, (t) => [
  index("arena_match_id_idx").on(t.matchId),
]);

export const entryPasses = pgTable("entry_pass", {
  id: uuid("id").primaryKey().defaultRandom(),
  arenaId: uuid("arena_id")
    .notNull()
    .references(() => arenas.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  walletAddress: text("wallet_address").notNull(),
  amountLamports: bigint("amount_lamports", { mode: "number" }).notNull(),
  txSignature: text("tx_signature").notNull(),
  status: entryPassStatusEnum("status").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("entry_pass_arena_user_idx").on(t.arenaId, t.userId),
  index("entry_pass_arena_id_idx").on(t.arenaId),
]);

export const predictionRounds = pgTable("prediction_round", {
  id: uuid("id").primaryKey().defaultRandom(),
  arenaId: uuid("arena_id")
    .notNull()
    .references(() => arenas.id),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  windowStartMinute: integer("window_start_minute").notNull(),
  windowEndMinute: integer("window_end_minute").notNull(),
  question: text("question").notNull(),
  targetEventType: targetEventTypeEnum("target_event_type").notNull(),
  targetTeam: teamSideEnum("target_team").notNull(),
  /** Machine-readable settlement condition (SettlementCondition from @arena/contracts). */
  settlementCondition: jsonb("settlement_condition").notNull(),
  status: roundStatusEnum("status").notNull(),
  correctAnswer: answerEnum("correct_answer"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledBy: settledByEnum("settled_by"),
  ...timestamps,
}, (t) => [
  index("prediction_round_arena_id_idx").on(t.arenaId),
]);

export const arenaPlayers = pgTable("arena_player", {
  id: uuid("id").primaryKey().defaultRandom(),
  arenaId: uuid("arena_id")
    .notNull()
    .references(() => arenas.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: arenaPlayerStatusEnum("status").notNull(),
  score: integer("score").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  eliminatedRoundId: uuid("eliminated_round_id").references(() => predictionRounds.id),
  ...timestamps,
}, (t) => [
  uniqueIndex("arena_player_arena_user_idx").on(t.arenaId, t.userId),
  index("arena_player_arena_id_idx").on(t.arenaId),
]);

export const predictions = pgTable("prediction", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => predictionRounds.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  answer: answerEnum("answer").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
  /** When backend received it — source of truth for reconnect tie-break (spec §9). */
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  result: predictionResultEnum("result"),
  ...timestamps,
}, (t) => [
  uniqueIndex("prediction_round_user_idx").on(t.roundId, t.userId),
  index("prediction_round_id_idx").on(t.roundId),
]);

export const liveEvents = pgTable("live_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  eventType: targetEventTypeEnum("event_type").notNull(),
  team: teamSideEnum("team").notNull(),
  matchMinute: integer("match_minute").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  /** provisional (false) vs confirmed (true) — spec §5.1. */
  confirmed: boolean("confirmed").notNull(),
  rawPayload: jsonb("raw_payload"),
  ...timestamps,
}, (t) => [
  index("live_event_match_minute_idx").on(t.matchId, t.matchMinute),
]);

export const payouts = pgTable("payout", {
  id: uuid("id").primaryKey().defaultRandom(),
  arenaId: uuid("arena_id")
    .notNull()
    .references(() => arenas.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  amountLamports: bigint("amount_lamports", { mode: "number" }).notNull(),
  txSignature: text("tx_signature"),
  status: payoutStatusEnum("status").notNull(),
  ...timestamps,
}, (t) => [
  index("payout_arena_id_idx").on(t.arenaId),
]);

/** Immutable record committed atomically with each destructive replay reset. */
export const replayResetAudits = pgTable("demo_reset_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  fixtureId: integer("fixture_id").notNull(),
  database: text("database").notNull(),
  outcome: text("outcome").$type<"reset" | "nothing_to_reset">().notNull(),
  arenas: jsonb("arenas")
    .$type<
      Array<{
        id: string;
        status: string;
        onchainArenaId: number | null;
        escrowAccount: string;
      }>
    >()
    .notNull(),
}, (t) => [
  index("demo_reset_audit_fixture_id_idx").on(t.fixtureId),
]);
