// Zod-validated environment config for the CS2 live poller (cs2/run.ts). GRID_* settings
// (series id, poll interval, API key, ...) are already owned by grid/config/env.ts and reused
// as-is — this module only adds what GRID itself doesn't expose: the Series' scheduled kickoff
// time (spec §4 п.1's "10 min before scheduledStartTime" needs it before Match 1 ever goes live,
// the same way soccer's Arena bootstrap needs a TXODDS fixture start time) — plus CS2's own
// gateway port. Everything else the CS2 gateway needs (AUTH_SECRET, CORS_ORIGINS,
// EVENT_ACCESS_CODE_HASH, ...) is intentionally shared with soccer's `gateway/config.ts`
// singleton, not duplicated here — see cs2/run.ts's doc comment.

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  CS2_SCHEDULED_START_TIME: z.string().datetime({ message: "CS2_SCHEDULED_START_TIME must be an ISO-8601 datetime" }),
  // Deliberately its own variable, not a fallback onto PORT/GATEWAY_PORT (gateway/config.ts) —
  // the soccer and CS2 gateways are separate processes reading the same .env; sharing a port
  // would make the second process fail to listen (EADDRINUSE), not just be confusing.
  CS2_GATEWAY_PORT: z.coerce.number().int().positive().default(4100),
  // Best-effort raw-poll recording into Mongo (see raw-recorder.ts) — off by default. Reuses
  // GRID_MONGODB_URI/DB from grid/config/env.ts rather than duplicating them here; if enabled
  // without a Mongo URI configured, cs2/run.ts logs a warning and runs without recording instead
  // of failing to start.
  CS2_RAW_RECORDING_ENABLED: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid CS2 live poller environment configuration:\n${issues.join("\n")}`);
}

export const cs2Config = {
  scheduledStartTime: parsed.data.CS2_SCHEDULED_START_TIME,
  gatewayPort: parsed.data.CS2_GATEWAY_PORT,
  rawRecordingEnabled: parsed.data.CS2_RAW_RECORDING_ENABLED === "true",
};
