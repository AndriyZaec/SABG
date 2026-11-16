CREATE TABLE "leaderboard_prize_claim" (
	"scope_id" uuid NOT NULL,
	"place" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_url" text,
	"trade_url_updated_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"trade_url_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_prize_claim_pk" PRIMARY KEY("scope_id","place")
);
--> statement-breakpoint
ALTER TABLE "leaderboard_scope" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leaderboard_prize_claim" ADD CONSTRAINT "leaderboard_prize_claim_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_prize_claim" ADD CONSTRAINT "leaderboard_prize_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_prize_claim_scope_user_idx" ON "leaderboard_prize_claim" USING btree ("scope_id","user_id");--> statement-breakpoint
ALTER TABLE "leaderboard_scope" ADD CONSTRAINT "leaderboard_scope_finalized_check" CHECK ("leaderboard_scope"."finalized_at" is null or "leaderboard_scope"."status" = 'closed');