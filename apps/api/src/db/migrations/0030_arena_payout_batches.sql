CREATE TABLE "payout_attempt" (
	"signature" text PRIMARY KEY NOT NULL,
	"arena_id" uuid NOT NULL,
	"step" text NOT NULL,
	"from_index" integer NOT NULL,
	"winner_count" integer NOT NULL,
	"raw" text NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_plan" (
	"arena_id" uuid PRIMARY KEY NOT NULL,
	"onchain_arena_id" bigint NOT NULL,
	"winner_ids" jsonb NOT NULL,
	"recipients" jsonb,
	"share_lamports" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"issue" text,
	"paid_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_plan_onchain_arena_id_unique" UNIQUE("onchain_arena_id")
);
--> statement-breakpoint
ALTER TABLE "payout_attempt" ADD CONSTRAINT "payout_attempt_arena_id_payout_plan_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."payout_plan"("arena_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_plan" ADD CONSTRAINT "payout_plan_arena_id_arena_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arena"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_attempt_step_idx" ON "payout_attempt" USING btree ("arena_id","step","from_index");