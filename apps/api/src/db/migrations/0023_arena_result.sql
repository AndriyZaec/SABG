CREATE TABLE "arena_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"rank" integer NOT NULL,
	"won" boolean NOT NULL,
	"rounds_played" integer NOT NULL,
	"players_count" integer NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_result_score_check" CHECK ("arena_result"."score" >= 0),
	CONSTRAINT "arena_result_rank_check" CHECK ("arena_result"."rank" >= 1),
	CONSTRAINT "arena_result_rounds_played_check" CHECK ("arena_result"."rounds_played" >= 0),
	CONSTRAINT "arena_result_players_count_check" CHECK ("arena_result"."players_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "arena_result" ADD CONSTRAINT "arena_result_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_result" ADD CONSTRAINT "arena_result_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_result" ADD CONSTRAINT "arena_result_competition_id_cs2_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."cs2_competition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_result_arena_user_idx" ON "arena_result" USING btree ("arena_id","user_id");--> statement-breakpoint
CREATE INDEX "arena_result_competition_id_idx" ON "arena_result" USING btree ("competition_id");