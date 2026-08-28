CREATE TABLE "cs2_match_team_score" (
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cs2_match_team_score_pk" PRIMARY KEY("match_id","team_id"),
	CONSTRAINT "cs2_match_team_score_score_check" CHECK ("cs2_match_team_score"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cs2_series_participant" (
	"series_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"display_order" smallint NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cs2_series_participant_pk" PRIMARY KEY("series_id","team_id"),
	CONSTRAINT "cs2_series_participant_display_order_check" CHECK ("cs2_series_participant"."display_order" in (1, 2)),
	CONSTRAINT "cs2_series_participant_score_check" CHECK ("cs2_series_participant"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cs2_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grid_team_id" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cs2_team_grid_team_id_not_blank" CHECK (btrim("cs2_team"."grid_team_id") <> ''),
	CONSTRAINT "cs2_team_name_not_blank" CHECK (btrim("cs2_team"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "cs2_match_team_score" ADD CONSTRAINT "cs2_match_team_score_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cs2_match_team_score" ADD CONSTRAINT "cs2_match_team_score_team_id_cs2_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."cs2_team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cs2_series_participant" ADD CONSTRAINT "cs2_series_participant_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cs2_series_participant" ADD CONSTRAINT "cs2_series_participant_team_id_cs2_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."cs2_team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cs2_match_team_score_team_id_idx" ON "cs2_match_team_score" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cs2_series_participant_order_idx" ON "cs2_series_participant" USING btree ("series_id","display_order");--> statement-breakpoint
CREATE INDEX "cs2_series_participant_team_id_idx" ON "cs2_series_participant" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cs2_team_grid_team_id_idx" ON "cs2_team" USING btree ("grid_team_id");--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "cs2_team"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "series"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
