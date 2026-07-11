ALTER TABLE "live_event" ALTER COLUMN "event_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "target_event_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."target_event_type";--> statement-breakpoint
CREATE TYPE "public"."target_event_type" AS ENUM('shot', 'shot_on_target', 'corner', 'card', 'goal', 'penalty', 'substitution');--> statement-breakpoint
ALTER TABLE "live_event" ALTER COLUMN "event_type" SET DATA TYPE "public"."target_event_type" USING "event_type"::"public"."target_event_type";--> statement-breakpoint
ALTER TABLE "prediction_round" ALTER COLUMN "target_event_type" SET DATA TYPE "public"."target_event_type" USING "target_event_type"::"public"."target_event_type";