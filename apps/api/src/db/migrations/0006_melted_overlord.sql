CREATE TABLE "demo_reset_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"fixture_id" integer NOT NULL,
	"database" text NOT NULL,
	"outcome" text NOT NULL,
	"arenas" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_reset_audit_fixture_id_idx" ON "demo_reset_audit" USING btree ("fixture_id");