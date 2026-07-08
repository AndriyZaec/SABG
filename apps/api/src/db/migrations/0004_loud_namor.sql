ALTER TABLE "match" ADD COLUMN "txodds_fixture_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "match_teams_start_time_idx" ON "match" USING btree ("home_team","away_team","start_time");--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_txodds_fixture_id_unique" UNIQUE("txodds_fixture_id");