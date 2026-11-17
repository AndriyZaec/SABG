CREATE TYPE "public"."leaderboard_mark_action" AS ENUM('approve', 'disqualify', 'clear');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_mark_status" AS ENUM('approved', 'disqualified');--> statement-breakpoint
CREATE TABLE "leaderboard_mark_draft" (
	"scope_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "leaderboard_mark_action" NOT NULL,
	"reason" text,
	"actor_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_mark_draft_pk" PRIMARY KEY("scope_id","user_id"),
	CONSTRAINT "leaderboard_mark_draft_reason_check" CHECK (("leaderboard_mark_draft"."action" = 'disqualify') = ("leaderboard_mark_draft"."reason" is not null) and char_length("leaderboard_mark_draft"."reason") <= 280)
);
--> statement-breakpoint
CREATE TABLE "leaderboard_mark" (
	"scope_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "leaderboard_mark_status" NOT NULL,
	"reason" text,
	"applied_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_mark_pk" PRIMARY KEY("scope_id","user_id"),
	CONSTRAINT "leaderboard_mark_reason_check" CHECK (("leaderboard_mark"."status" = 'disqualified') = ("leaderboard_mark"."reason" is not null) and char_length("leaderboard_mark"."reason") <= 280)
);
--> statement-breakpoint
ALTER TABLE "leaderboard_mark_draft" ADD CONSTRAINT "leaderboard_mark_draft_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_mark_draft" ADD CONSTRAINT "leaderboard_mark_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_mark" ADD CONSTRAINT "leaderboard_mark_scope_id_leaderboard_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."leaderboard_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_mark" ADD CONSTRAINT "leaderboard_mark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;