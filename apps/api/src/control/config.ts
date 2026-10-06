import { z } from "zod";

const ControlConfigSchema = z.object({
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
      port: parsed.data.CS2_CONTROL_PORT,
      machineToken: parsed.data.CS2_CONTROL_MACHINE_TOKEN,
    };
