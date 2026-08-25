ALTER TYPE "public"."arena_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "arena" ADD COLUMN "cancelled_reason" text;