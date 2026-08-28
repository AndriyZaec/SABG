ALTER TABLE "match" ALTER COLUMN "home_team" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ALTER COLUMN "away_team" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ALTER COLUMN "score_home" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match" ALTER COLUMN "score_away" DROP NOT NULL;--> statement-breakpoint
INSERT INTO "cs2_match_team_score" ("match_id", "team_id", "score")
SELECT
	"match"."id",
	"cs2_series_participant"."team_id",
	CASE "cs2_series_participant"."display_order"
		WHEN 1 THEN "match"."score_home"
		ELSE "match"."score_away"
	END
FROM "match"
INNER JOIN "cs2_series_participant"
	ON "cs2_series_participant"."series_id" = "match"."series_id"
WHERE "match"."discipline" = 'cs2'
ON CONFLICT ("match_id", "team_id") DO NOTHING;--> statement-breakpoint
UPDATE "match"
SET "home_team" = NULL, "away_team" = NULL, "score_home" = NULL, "score_away" = NULL
WHERE "discipline" = 'cs2';--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_soccer_fields_check" CHECK ("match"."discipline" <> 'soccer' OR ("match"."home_team" IS NOT NULL AND "match"."away_team" IS NOT NULL AND "match"."score_home" IS NOT NULL AND "match"."score_away" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_cs2_fields_check" CHECK ("match"."discipline" <> 'cs2' OR ("match"."series_id" IS NOT NULL AND "match"."series_match_index" IS NOT NULL AND "match"."home_team" IS NULL AND "match"."away_team" IS NULL AND "match"."score_home" IS NULL AND "match"."score_away" IS NULL));
