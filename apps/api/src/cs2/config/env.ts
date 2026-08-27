import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const commonConfig = {
  // The CS2 and soccer gateways run concurrently in local development.
  CS2_GATEWAY_PORT: z.coerce.number().int().positive().default(4100),
  CS2_RAW_RECORDING_ENABLED: z.string().optional(),
};
const envSchema = z.discriminatedUnion("CS2_RUNTIME_MODE", [
  z.object({
    ...commonConfig,
    CS2_RUNTIME_MODE: z.literal("catalog"),
  }),
  z.object({
    ...commonConfig,
    CS2_RUNTIME_MODE: z.literal("live"),
    CS2_SCHEDULED_START_TIME: z.string().datetime({ message: "CS2_SCHEDULED_START_TIME must be an ISO-8601 datetime" }),
    GRID_SERIES_ID: z.string().min(1, "GRID_SERIES_ID is required in live mode"),
  }),
]);

const parsed = envSchema.safeParse({
  ...process.env,
  CS2_RUNTIME_MODE: process.env["CS2_RUNTIME_MODE"] ?? "catalog",
  CS2_GATEWAY_PORT: process.env["CS2_GATEWAY_PORT"] ?? process.env["PORT"],
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid CS2 runtime environment configuration:\n${issues.join("\n")}`);
}

export const cs2Config = parsed.data.CS2_RUNTIME_MODE === "live"
  ? {
      mode: "live" as const,
      scheduledStartTime: parsed.data.CS2_SCHEDULED_START_TIME,
      activeGridSeriesId: parsed.data.GRID_SERIES_ID,
      gatewayPort: parsed.data.CS2_GATEWAY_PORT,
      rawRecordingEnabled: parsed.data.CS2_RAW_RECORDING_ENABLED === "true",
    }
  : {
      mode: "catalog" as const,
      gatewayPort: parsed.data.CS2_GATEWAY_PORT,
      rawRecordingEnabled: parsed.data.CS2_RAW_RECORDING_ENABLED === "true",
    };
