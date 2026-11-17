CREATE TABLE "leaderboard_prize" (
	"scope_id" uuid NOT NULL,
	"place" integer NOT NULL,
	"image_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_prize_pk" PRIMARY KEY("scope_id","place"),
	CONSTRAINT "leaderboard_prize_place_positive" CHECK ("leaderboard_prize"."place" >= 1),
	CONSTRAINT "leaderboard_prize_image_url_https" CHECK ("leaderboard_prize"."image_url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "leaderboard_prize" ADD CONSTRAINT "leaderboard_prize_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;