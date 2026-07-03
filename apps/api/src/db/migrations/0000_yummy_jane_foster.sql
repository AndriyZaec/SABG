CREATE TYPE "public"."answer" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."arena_player_status" AS ENUM('active', 'eliminated', 'winner');--> statement-breakpoint
CREATE TYPE "public"."arena_status" AS ENUM('lobby', 'live', 'finished');--> statement-breakpoint
CREATE TYPE "public"."entry_pass_status" AS ENUM('paid', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."match_period" AS ENUM('pre', 'first_half', 'halftime', 'second_half', 'full_time');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'finished');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prediction_result" AS ENUM('correct', 'incorrect', 'missed');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('pending', 'open', 'locked', 'settled');--> statement-breakpoint
CREATE TYPE "public"."settled_by" AS ENUM('early', 'window_end');--> statement-breakpoint
CREATE TYPE "public"."target_event_type" AS ENUM('shot', 'shot_on_target', 'corner', 'card', 'goal', 'free_kick', 'penalty', 'substitution');--> statement-breakpoint
CREATE TYPE "public"."team_side" AS ENUM('home', 'away', 'any');--> statement-breakpoint
CREATE TABLE "arena_player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "arena_player_status" NOT NULL,
	"score" integer NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"eliminated_round_id" uuid
);
--> statement-breakpoint
CREATE TABLE "arena" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"status" "arena_status" NOT NULL,
	"active_players_count" integer NOT NULL,
	"entry_fee_lamports" bigint NOT NULL,
	"prize_pool_lamports" bigint NOT NULL,
	"escrow_account" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_pass" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"tx_signature" text NOT NULL,
	"status" "entry_pass_status" NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"event_type" "target_event_type" NOT NULL,
	"team" "team_side" NOT NULL,
	"match_minute" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"confirmed" boolean NOT NULL,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"status" "match_status" NOT NULL,
	"current_minute" integer NOT NULL,
	"period" "match_period" NOT NULL,
	"score_home" integer NOT NULL,
	"score_away" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"tx_signature" text,
	"status" "payout_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"window_start_minute" integer NOT NULL,
	"window_end_minute" integer NOT NULL,
	"question" text NOT NULL,
	"target_event_type" "target_event_type" NOT NULL,
	"target_team" "team_side" NOT NULL,
	"settlement_condition" jsonb NOT NULL,
	"status" "round_status" NOT NULL,
	"correct_answer" "answer",
	"opened_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"settled_by" "settled_by"
);
--> statement-breakpoint
CREATE TABLE "prediction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" "answer" NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"result" "prediction_result"
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"username" text NOT NULL,
	"avatar" text
);
--> statement-breakpoint
ALTER TABLE "arena_player" ADD CONSTRAINT "arena_player_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_player" ADD CONSTRAINT "arena_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_player" ADD CONSTRAINT "arena_player_eliminated_round_id_prediction_round_id_fk" FOREIGN KEY ("eliminated_round_id") REFERENCES "public"."prediction_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena" ADD CONSTRAINT "arena_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_pass" ADD CONSTRAINT "entry_pass_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_pass" ADD CONSTRAINT "entry_pass_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_event" ADD CONSTRAINT "live_event_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_round" ADD CONSTRAINT "prediction_round_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_round" ADD CONSTRAINT "prediction_round_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_round_id_prediction_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."prediction_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_player_arena_user_idx" ON "arena_player" USING btree ("arena_id","user_id");--> statement-breakpoint
CREATE INDEX "arena_player_arena_id_idx" ON "arena_player" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "arena_match_id_idx" ON "arena" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_pass_arena_user_idx" ON "entry_pass" USING btree ("arena_id","user_id");--> statement-breakpoint
CREATE INDEX "entry_pass_arena_id_idx" ON "entry_pass" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "live_event_match_minute_idx" ON "live_event" USING btree ("match_id","match_minute");--> statement-breakpoint
CREATE INDEX "payout_arena_id_idx" ON "payout" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "prediction_round_arena_id_idx" ON "prediction_round" USING btree ("arena_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_round_user_idx" ON "prediction" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "prediction_round_id_idx" ON "prediction" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallet_address_idx" ON "user" USING btree ("wallet_address");