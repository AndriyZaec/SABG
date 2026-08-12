// Zod-validated environment config for the Grid.gg CS2 series-state poller (src/grid/**).
// Deliberately separate from src/live/config/env.ts: that module requires
// SOLANA_WALLET_PRIVATE_KEY for the TXODDS/TxLine auth chain, which this poller has no use for.

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  GRID_API_KEY: z.string().min(1, "GRID_API_KEY is required"),
  GRID_GRAPHQL_URL: z.string().url().default("https://api-op.grid.gg/live-data-feed/series-state/graphql"),
  // Substituted into the query loaded from GRID_QUERY_FILE at runtime — the file's own literal
  // series id ("28") is never edited.
  GRID_SERIES_ID: z.string().min(1).default("28"),
  GRID_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  GRID_RATE_LIMIT_RETRY_MS: z.coerce.number().int().positive().default(1_000),
  GRID_MAX_RATE_LIMIT_RETRIES: z.coerce.number().int().nonnegative().default(5),
  GRID_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Resolved relative to the apps/api package root (process.cwd() when run via the grid:record script).
  GRID_QUERY_FILE: z.string().min(1).default("graphql-schema-request.txt"),
  // Optional: only grid:record (GridRecorder, writes to Mongo) and the CS2 live poller with
  // CS2_RAW_RECORDING_ENABLED=true (cs2/raw-recorder.ts) need this — enforced lazily by
  // MongoService.getDb() at the point of connecting, not here.
  MONGODB_URI: z.string().min(1).optional(),
  MONGODB_DB: z.string().default("sabg_raw"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid grid-recorder environment configuration:\n${issues.join("\n")}`);
}

const env = parsed.data;

export const gridConfig = {
  grid: {
    apiKey: env.GRID_API_KEY,
    graphqlUrl: env.GRID_GRAPHQL_URL,
    seriesId: env.GRID_SERIES_ID,
    pollIntervalMs: env.GRID_POLL_INTERVAL_MS,
    rateLimitRetryMs: env.GRID_RATE_LIMIT_RETRY_MS,
    maxRateLimitRetries: env.GRID_MAX_RATE_LIMIT_RETRIES,
    requestTimeoutMs: env.GRID_REQUEST_TIMEOUT_MS,
    queryFile: env.GRID_QUERY_FILE,
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
