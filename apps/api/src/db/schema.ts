import {
  ANSWERS,
  ARENA_PLAYER_STATUSES,
  ARENA_STATUSES,
  DISCIPLINES,
  ENTRY_PASS_STATUSES,
  MATCH_PERIODS,
  MATCH_STATUSES,
  PAYOUT_STATUSES,
  PREDICTION_RESULTS,
  ROUND_STATUSES,
  SERIES_STATUSES,
  SETTLED_BY_VALUES,
  TARGET_EVENT_TYPES,
  TEAM_SIDES,
} from "@arena/contracts";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
export const disciplineEnum = pgEnum("discipline", DISCIPLINES);
export const seriesStatusEnum = pgEnum("series_status", SERIES_STATUSES);

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

export const series = pgTable("series", {
  id: uuid("id").primaryKey().defaultRandom(),
  gridSeriesId: text("grid_series_id").notNull().unique(),
  format: integer("format").notNull(),
  scheduledStartTime: timestamp("scheduled_start_time", { withTimezone: true }).notNull(),
  status: seriesStatusEnum("status").notNull(),
  ...timestamps,
});

export const cs2Teams = pgTable("cs2_team", {
  id: uuid("id").primaryKey().defaultRandom(),
  gridTeamId: text("grid_team_id").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  logoUrl: text("logo_url"),
  ...timestamps,
}, (t) => [
  uniqueIndex("cs2_team_grid_team_id_idx").on(t.gridTeamId),
  check("cs2_team_grid_team_id_not_blank", sql`btrim(${t.gridTeamId}) <> ''`),
  check("cs2_team_name_not_blank", sql`btrim(${t.name}) <> ''`),
]);

export const cs2SeriesParticipants = pgTable("cs2_series_participant", {
  seriesId: uuid("series_id")
    .notNull()
    .references(() => series.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => cs2Teams.id, { onDelete: "restrict" }),
  displayOrder: smallint("display_order").notNull(),
  score: integer("score").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.seriesId, t.teamId], name: "cs2_series_participant_pk" }),
  uniqueIndex("cs2_series_participant_order_idx").on(t.seriesId, t.displayOrder),
  index("cs2_series_participant_team_id_idx").on(t.teamId),
  check("cs2_series_participant_display_order_check", sql`${t.displayOrder} in (1, 2)`),
  check("cs2_series_participant_score_check", sql`${t.score} >= 0`),
]);

export const matches = pgTable("match", {
  id: uuid("id").primaryKey().defaultRandom(),
  discipline: disciplineEnum("discipline").notNull().default("soccer"),
  txoddsFixtureId: integer("txodds_fixture_id").unique(),
  seriesId: uuid("series_id").references(() => series.id),
  seriesMatchIndex: integer("series_match_index"),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  status: matchStatusEnum("status").notNull(),
  currentMinute: integer("current_minute").notNull(),
  period: matchPeriodEnum("period").notNull(),
  scoreHome: integer("score_home"),
  scoreAway: integer("score_away"),
  ...timestamps,
}, (t) => [
  uniqueIndex("match_teams_start_time_idx").on(t.homeTeam, t.awayTeam, t.startTime),
  index("match_series_id_idx").on(t.seriesId),
  uniqueIndex("match_series_match_index_idx").on(t.seriesId, t.seriesMatchIndex),
  check(
    "match_soccer_fields_check",
    sql`${t.discipline} <> 'soccer' OR (${t.homeTeam} IS NOT NULL AND ${t.awayTeam} IS NOT NULL AND ${t.scoreHome} IS NOT NULL AND ${t.scoreAway} IS NOT NULL)`,
  ),
  check(
    "match_cs2_fields_check",
    sql`${t.discipline} <> 'cs2' OR (${t.seriesId} IS NOT NULL AND ${t.seriesMatchIndex} IS NOT NULL AND ${t.homeTeam} IS NULL AND ${t.awayTeam} IS NULL AND ${t.scoreHome} IS NULL AND ${t.scoreAway} IS NULL)`,
  ),
]);

export const cs2MatchTeamScores = pgTable("cs2_match_team_score", {
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => cs2Teams.id, { onDelete: "restrict" }),
  score: integer("score").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.matchId, t.teamId], name: "cs2_match_team_score_pk" }),
  index("cs2_match_team_score_team_id_idx").on(t.teamId),
  check("cs2_match_team_score_score_check", sql`${t.score} >= 0`),
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
  onchainArenaId: bigint("onchain_arena_id", { mode: "number" }),
  cancelledReason: text("cancelled_reason"),
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
  discipline: disciplineEnum("discipline").notNull().default("soccer"),
  windowStartMinute: integer("window_start_minute"),
  windowEndMinute: integer("window_end_minute"),
  roundNumber: integer("round_number"),
  question: text("question").notNull(),
  targetEventType: targetEventTypeEnum("target_event_type"),
  targetTeam: teamSideEnum("target_team"),
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
  // Persist receipt time as the reconnect tie-break authority.
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

// Commit an immutable audit record with each destructive reset.
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
