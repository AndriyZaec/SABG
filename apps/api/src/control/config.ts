import { z } from "zod";

const ControlConfigSchema = z.object({
  CS2_CONTROL_HOST: z.string().trim().min(1).regex(/^[A-Za-z0-9.-]+$/u).default("127.0.0.1"),
  CS2_CONTROL_PORT: z.coerce.number().int().positive().default(4101),
  CS2_CONTROL_MACHINE_TOKEN: z.string().min(32).optional(),
});

const parsed = ControlConfigSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid CS2 control environment configuration:\n${issues.join("\n")}`);
}

export const operatorControlConfig = parsed.data.CS2_CONTROL_MACHINE_TOKEN === undefined
    ? undefined
    : {
      host: parsed.data.CS2_CONTROL_HOST,
      port: parsed.data.CS2_CONTROL_PORT,
      machineToken: parsed.data.CS2_CONTROL_MACHINE_TOKEN,
    };
