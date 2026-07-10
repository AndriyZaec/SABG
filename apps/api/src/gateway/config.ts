// B7 — Realtime Gateway config. Scoped to src/gateway/** only, mirrors the src/live/config/env.ts
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
  /** Comma-separated CORS origins; "*" (default) matches the mock's permissive dev behavior. */
  CORS_ORIGINS: z.string().default("*"),
  /**
   * Speeds up the demo replay's round lead time (spec §5 default is >=60s). Mirrors the mock's
   * MOCK_LEAD_MS override so a manual walkthrough doesn't take 17 rounds x 60s+.
   */
  GATEWAY_LEAD_TIME_SECONDS: z.coerce.number().int().positive().optional(),
  /**
   * Wall-clock delay between fixture messages in the demo replay (gateway/run.ts). The recorded
   * fixture's own match-clock signals have no built-in pacing — replayed with 0 delay, all 17
   * rounds resolve in milliseconds. A small per-message delay makes a manual WS walkthrough
   * actually watchable in real time.
   */
  GATEWAY_REPLAY_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
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
  },
  cors: {
    origins: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((o) => o.trim()),
  },
  replay: {
    leadTimeSeconds: env.GATEWAY_LEAD_TIME_SECONDS,
    delayMs: env.GATEWAY_REPLAY_DELAY_MS,
  },
  log: {
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  },
};
