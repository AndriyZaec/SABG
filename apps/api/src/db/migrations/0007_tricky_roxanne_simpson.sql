CREATE TYPE "public"."discipline" AS ENUM('soccer', 'cs2');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('active', 'decided', 'invalid');--> statement-breakpoint
ALTER TYPE "public"."round_status" ADD VALUE 'voided';--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grid_series_id" text NOT NULL,
	"format" integer NOT NULL,
	"scheduled_start_time" timestamp with time zone NOT NULL,
	"status" "series_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_grid_series_id_unique" UNIQUE("grid_series_id")
);
--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "window_start_minute" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "window_end_minute" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "target_event_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "target_team" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "discipline" "discipline" DEFAULT 'soccer' NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "prediction_round" ADD COLUMN "discipline" "discipline" DEFAULT 'soccer' NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_round" ADD COLUMN "round_number" integer;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_series_id_idx" ON "match" USING btree ("series_id");