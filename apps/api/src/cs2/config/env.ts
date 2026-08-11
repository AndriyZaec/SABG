// Zod-validated environment config for the CS2 live poller (cs2/run.ts). GRID_* settings
// (series id, poll interval, API key, ...) are already owned by grid/config/env.ts and reused
// as-is — this module only adds what GRID itself doesn't expose: the Series' scheduled kickoff
// time (spec §4 п.1's "10 min before scheduledStartTime" needs it before Match 1 ever goes live,
// the same way soccer's Arena bootstrap needs a TXODDS fixture start time).

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  CS2_SCHEDULED_START_TIME: z.string().datetime({ message: "CS2_SCHEDULED_START_TIME must be an ISO-8601 datetime" }),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid CS2 live poller environment configuration:\n${issues.join("\n")}`);
}

export const cs2Config = {
  scheduledStartTime: parsed.data.CS2_SCHEDULED_START_TIME,
};
