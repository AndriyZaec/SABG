CREATE TYPE "public"."cs2_series_lifecycle" AS ENUM('upcoming', 'live', 'completed', 'unknown');--> statement-breakpoint
CREATE TABLE "cs2_competition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grid_tournament_id" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cs2_competition_grid_tournament_id_not_blank" CHECK (btrim("cs2_competition"."grid_tournament_id") <> ''),
	CONSTRAINT "cs2_competition_name_not_blank" CHECK (btrim("cs2_competition"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "competition_id" uuid;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "catalog_lifecycle" "cs2_series_lifecycle" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "is_supported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cs2_competition_grid_tournament_id_idx" ON "cs2_competition" USING btree ("grid_tournament_id");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_competition_id_cs2_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."cs2_competition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_competition_id_idx" ON "series" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "series_catalog_idx" ON "series" USING btree ("is_supported","catalog_lifecycle","scheduled_start_time");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_format_check" CHECK ("series"."format" between 1 and 7);--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "cs2_competition"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
