CREATE TABLE "operator_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_login" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"result" text NOT NULL,
	"request_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "series_stream_url_check";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "value" text;--> statement-breakpoint
CREATE INDEX "operator_audit_created_at_id_idx" ON "operator_audit" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "operator_audit_actor_created_at_id_idx" ON "operator_audit" USING btree ("actor_id","created_at","id");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_stream_url_check" CHECK ("series"."stream_url" is null or "series"."stream_url" ~ '^https://((twitch\.tv|kick\.com)/[A-Za-z0-9_-]+|www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11})$');