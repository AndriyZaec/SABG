import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  CS2_SCHEDULED_START_TIME: z.string().datetime({ message: "CS2_SCHEDULED_START_TIME must be an ISO-8601 datetime" }),
  // The CS2 and soccer gateways run concurrently and require separate ports.
  CS2_GATEWAY_PORT: z.coerce.number().int().positive().default(4100),
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
