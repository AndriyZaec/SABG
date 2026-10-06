import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // The CS2 and soccer gateways run concurrently in local development.
  CS2_GATEWAY_PORT: z.coerce.number().int().positive().default(4100),
  CS2_RAW_RECORDING_ENABLED: z.string().optional(),
});

const parsed = envSchema.safeParse({
  ...process.env,
  CS2_GATEWAY_PORT: process.env["CS2_GATEWAY_PORT"] ?? process.env["PORT"],
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid CS2 runtime environment configuration:\n${issues.join("\n")}`);
}

export const cs2Config = {
  gatewayPort: parsed.data.CS2_GATEWAY_PORT,
  rawRecordingEnabled: parsed.data.CS2_RAW_RECORDING_ENABLED === "true",
};
