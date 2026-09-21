import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid push environment configuration:\n${issues.join("\n")}`);
}

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = parsed.data;

// Push is optional infrastructure: unrelated runtimes (mock, football gateway, CS2 catalog mode)
// must still start without VAPID configured. Only sending an actual push requires it.
export const pushConfig =
  VAPID_PUBLIC_KEY !== undefined && VAPID_PRIVATE_KEY !== undefined && VAPID_SUBJECT !== undefined
    ? { configured: true as const, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT }
    : { configured: false as const };
