ALTER TABLE "match" ADD COLUMN "series_match_index" integer;--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "series_id" ORDER BY "created_at", "id")::integer AS "match_index"
	FROM "match"
	WHERE "series_id" IS NOT NULL
)
UPDATE "match"
SET "series_match_index" = ranked."match_index"
FROM ranked
WHERE "match"."id" = ranked."id";--> statement-breakpoint
CREATE UNIQUE INDEX "match_series_match_index_idx" ON "match" USING btree ("series_id","series_match_index");
