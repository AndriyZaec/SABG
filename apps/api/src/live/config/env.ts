// Zod-validated environment config for the live TXODDS SSE worker (apps/api has no config
// module yet outside the raw process.env reads in db/client.ts and mock/server.ts — this one
// is scoped to src/live/** only). Ported from the world-cup draft's utils/env.ts, trimmed to
// what the SSE stream path actually needs (no polling/Redis config).

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Devnet only (CLAUDE.md) — no mainnet keys or funds in this repo.
  SOLANA_NETWORK: z.literal("devnet").default("devnet"),
  SOLANA_WALLET_PRIVATE_KEY: z.string().min(1, "SOLANA_WALLET_PRIVATE_KEY is required"),
  // The TXODDS Scores API (/scores/stream) — distinct from TxLine's auth/subscription origin
  // in config/network.ts (API_ORIGIN).
  TXODDS_BASE_URL: z.string().default("https://api.txodds.com"),
  TXODDS_LIVE_FIXTURE_ID: z.coerce.number().int().positive().default(18179764),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().default("sabg_raw"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid live-worker environment configuration:\n${issues.join("\n")}`);
}

const env = parsed.data;

export const liveConfig = {
  solana: {
    privateKey: env.SOLANA_WALLET_PRIVATE_KEY,
    network: env.SOLANA_NETWORK,
  },
  txodds: {
    baseUrl: env.TXODDS_BASE_URL,
    fixtureId: env.TXODDS_LIVE_FIXTURE_ID,
  },
  mongo: {
    uri: env.MONGODB_URI,
    db: env.MONGODB_DB,
  },
  log: {
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  },
};
