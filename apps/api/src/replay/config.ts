// B8 — Replay Engine config. Scoped to src/replay/** only, mirrors gateway/config.ts's pattern
// (each track validates its own env slice with zod) rather than overloading gateway's module.

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  /** Playback speed multiplier for the demo replay — see replay/engine.ts's ReplayEngine. */
  REPLAY_SPEED: z.coerce.number().positive().default(60),
  /** Clamp on any single inter-message wait (real ms, pre-speed) — bounds idle gaps like halftime. */
  REPLAY_MAX_GAP_MS: z.coerce.number().int().nonnegative().default(2_000),
  /** Overrides B3's default (spec §5 minimum 60s) so rounds open/lock promptly under the sped-up clock. */
  REPLAY_LEAD_TIME_SECONDS: z.coerce.number().int().positive().optional(),
  /** Number of scripted bot players in the headless demo. */
  REPLAY_BOT_COUNT: z.coerce.number().int().positive().default(8),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid replay environment configuration:\n${issues.join("\n")}`);
}

const env = parsed.data;

export const replayConfig = {
  speed: env.REPLAY_SPEED,
  maxGapMs: env.REPLAY_MAX_GAP_MS,
  leadTimeSeconds: env.REPLAY_LEAD_TIME_SECONDS,
  botCount: env.REPLAY_BOT_COUNT,
  log: {
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  },
};
