CREATE TYPE "public"."leaderboard_scope_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "leaderboard_entry" (
	"scope_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"arenas_played" integer NOT NULL,
	"wins" integer NOT NULL,
	"second_places" integer NOT NULL,
	"rounds_played" integer NOT NULL,
	"total_score" integer NOT NULL,
	"total_payout_lamports" bigint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leaderboard_entry_pk" PRIMARY KEY("scope_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_scope_competition" (
	"scope_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_scope_competition_pk" PRIMARY KEY("scope_id","competition_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_scope" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "leaderboard_scope_status" DEFAULT 'open' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_scope_name_not_blank" CHECK (btrim("leaderboard_scope"."name") <> ''),
	CONSTRAINT "leaderboard_scope_closed_check" CHECK (("leaderboard_scope"."status" = 'closed') = ("leaderboard_scope"."closed_at" is not null) and not ("leaderboard_scope"."status" = 'closed' and "leaderboard_scope"."is_current"))
);
--> statement-breakpoint
ALTER TABLE "leaderboard_entry" ADD CONSTRAINT "leaderboard_entry_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entry" ADD CONSTRAINT "leaderboard_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_scope_competition" ADD CONSTRAINT "leaderboard_scope_competition_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_scope_competition" ADD CONSTRAINT "leaderboard_scope_competition_competition_id_cs2_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."cs2_competition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaderboard_entry_scope_rank_idx" ON "leaderboard_entry" USING btree ("scope_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_scope_one_current_idx" ON "leaderboard_scope" USING btree ("is_current") WHERE "leaderboard_scope"."is_current";