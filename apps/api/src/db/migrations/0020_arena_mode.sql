CREATE TYPE "public"."arena_mode" AS ENUM('classic', 'hardcore');--> statement-breakpoint
ALTER TABLE "arena" ADD COLUMN "mode" "arena_mode" DEFAULT 'hardcore' NOT NULL;--> statement-breakpoint
ALTER TABLE "arena" ALTER COLUMN "mode" DROP DEFAULT;
