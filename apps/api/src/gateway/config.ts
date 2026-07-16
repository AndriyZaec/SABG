// Realtime Gateway config. Scoped to src/gateway/** only, mirrors the src/live/config/env.ts
// pattern (each track validates its own env slice with zod) rather than overloading that
// worker-specific module. `DATABASE_URL` itself is read by db/client.ts; this only adds the
// gateway-specific knobs.

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  GATEWAY_PORT: z.coerce.number().int().positive().default(4000),
  /** HMAC secret for session tokens (auth.ts). Dev-only default — set a real secret in prod. */
  AUTH_SECRET: z.string().min(1).default("dev-insecure-auth-secret"),
  /**
   * Require a verified wallet signature over a server-issued nonce on POST /auth/wallet.
   * Default on (real security). Set "false" for a mock/demo that signs in with just a wallet
   * address (the standalone mock server keeps that permissive behavior regardless).
   */
  AUTH_REQUIRE_SIGNATURE: z.enum(["true", "false"]).default("true"),
  /** Comma-separated CORS origins; "*" (default) matches the mock's permissive dev behavior. */
  CORS_ORIGINS: z.string().default("*"),
  /**
   * Real seconds per match-minute for the demo replay — the single speed knob. Drives both the
   * clock pacing and the countdown projection (they must match), so rounds open/lock/settle at a
   * watchable, truthful cadence. Small = compressed demo; ~60 = real-match pace.
   */
  GATEWAY_SECONDS_PER_MATCH_MINUTE: z.coerce.number().positive().default(6),
  /**
   * Pre-kickoff lobby window: the demo arena stays `lobby` this long after the server is up so bots
   * and the human can join, then flips `live` and the replay starts. Longer when filming an on-chain
   * buy so the wallet tx confirms before kickoff.
   */
  GATEWAY_LOBBY_SECONDS: z.coerce.number().int().nonnegative().default(180),
  /** Seed scripted bots into the demo arena so the board/feed are populated. */
  GATEWAY_SEED_BOTS: z.enum(["true", "false"]).default("true"),
  GATEWAY_BOT_COUNT: z.coerce.number().int().positive().default(8),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid gateway environment configuration:\n${issues.join("\n")}`);
}

const env = parsed.data;

export const gatewayConfig = {
  port: env.GATEWAY_PORT,
  auth: {
    secret: env.AUTH_SECRET,
    requireSignature: env.AUTH_REQUIRE_SIGNATURE === "true",
  },
  cors: {
    origins: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((o) => o.trim()),
  },
  clock: {
    secondsPerMatchMinute: env.GATEWAY_SECONDS_PER_MATCH_MINUTE,
  },
  lobby: {
    seconds: env.GATEWAY_LOBBY_SECONDS,
  },
  bots: {
    enabled: env.GATEWAY_SEED_BOTS === "true",
    count: env.GATEWAY_BOT_COUNT,
  },
  log: {
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  },
};
