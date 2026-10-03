ALTER TYPE "public"."series_status" ADD VALUE 'skipped';--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "skip_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "settings" ("name") VALUES ('cs2_autopilot') ON CONFLICT ("name") DO NOTHING;
