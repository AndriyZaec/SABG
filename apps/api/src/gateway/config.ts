// Realtime Gateway config. Scoped to src/gateway/** only, mirrors the src/live/config/env.ts
// pattern (each track validates its own env slice with zod) rather than overloading that
// worker-specific module. `DATABASE_URL` itself is read by db/client.ts; this only adds the
// gateway-specific knobs.

import dotenv from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import type { GameSourceMode } from "@arena/contracts";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().optional(),
  GATEWAY_PORT: z.coerce.number().int().positive().default(4000),
  GAME_SOURCE: z.enum(["replay", "live"]).default("replay"),
  SOLANA_NETWORK: z.literal("devnet").default("devnet"),
  TXODDS_LIVE_FIXTURE_ID: z.coerce.number().int().positive().optional(),
  /** HMAC secret for session tokens (auth.ts). Dev-only default — set a real secret in prod. */
  AUTH_SECRET: z.string().min(1).default("dev-insecure-auth-secret"),
  /**
   * Require a verified wallet signature over a server-issued nonce on POST /auth/wallet.
   * Default on (real security). Set "false" only for a local mock that signs in with just a wallet
   * address (the standalone mock server keeps that permissive behavior regardless).
   */
  AUTH_REQUIRE_SIGNATURE: z.enum(["true", "false"]).default("true"),
  /** Comma-separated CORS origins; "*" (default) matches the mock's permissive dev behavior. */
  CORS_ORIGINS: z.string().default("*"),
  /**
   * Real seconds per match-minute for the recorded replay — the single speed knob. Drives both the
   * clock pacing and the countdown projection (they must match), so rounds open/lock/settle at a
   * watchable, truthful cadence. Small = compressed replay; ~60 = real-match pace.
   */
  GATEWAY_SECONDS_PER_MATCH_MINUTE: z.coerce.number().positive().default(6),
  /**
   * Which recorded fixture the replay drives — must have a matching
   * `ingestion/__fixtures__/fixture-<id>.json`. Default (18241006) is England v Argentina, the
   * semi-final; set to a different recorded fixture id (e.g. 18179764, the final) to rehearse that
   * match instead.
   */
  GATEWAY_REPLAY_FIXTURE_ID: z.coerce.number().int().positive().default(18241006),
  REPLAY_AUTO_RESTART: z.enum(["true", "false"]).default("false"),
  REPLAY_RESTART_DELAY_SECONDS: z.coerce.number().int().nonnegative().default(120),
  /**
   * Pre-kickoff lobby window: the arena stays `lobby` this long after the server is up so bots
   * and the human can join, then flips `live` and the replay starts. Longer when filming an on-chain
   * buy so the wallet tx confirms before kickoff.
   */
  GATEWAY_LOBBY_SECONDS: z.coerce.number().int().nonnegative().default(180),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
  WEB_DIST_DIR: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid gateway environment configuration:\n${issues.join("\n")}`);
}

const env = parsed.data;

if (
  env.NODE_ENV === "production" &&
  (env.AUTH_SECRET === "dev-insecure-auth-secret" ||
    env.AUTH_SECRET.startsWith("REPLACE_") ||
    env.AUTH_SECRET.length < 32)
) {
  throw new Error("AUTH_SECRET must be set to a non-default value of at least 32 characters in production");
}

const gameSource: GameSourceMode = env.GAME_SOURCE;

export const gatewayConfig = {
  port: env.PORT ?? env.GATEWAY_PORT,
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
  replay: {
    fixtureId: env.GATEWAY_REPLAY_FIXTURE_ID,
    autoRestart: env.REPLAY_AUTO_RESTART === "true",
    restartDelaySeconds: env.REPLAY_RESTART_DELAY_SECONDS,
  },
  live: {
    fixtureId: env.TXODDS_LIVE_FIXTURE_ID,
  },
  lobby: {
    seconds: env.GATEWAY_LOBBY_SECONDS,
  },
  log: {
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  },
  web: {
    distDir:
      env.WEB_DIST_DIR ??
      (env.NODE_ENV === "production" ? fileURLToPath(new URL("../../../web/dist/", import.meta.url)) : undefined),
  },
  runtime: {
    gameSource,
    sourceLabel: gameSource === "replay" ? "RECORDED REPLAY" : "LIVE FEED",
  },
};
