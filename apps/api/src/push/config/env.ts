import { createECDH, timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const vapidPublicKey = z.string().regex(/^[A-Za-z0-9_-]{80,120}$/);
const vapidPrivateKey = z.string().regex(/^[A-Za-z0-9_-]{40,120}$/);
const vapidSubject = z.string().refine((value) => {
  if (value.startsWith("mailto:") && value.length > "mailto:".length) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "VAPID subject must be a mailto: or HTTPS URL");

const envSchema = z.object({
  VAPID_PUBLIC_KEY: vapidPublicKey.optional(),
  VAPID_PRIVATE_KEY: vapidPrivateKey.optional(),
  VAPID_SUBJECT: vapidSubject.optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`Invalid push environment configuration:\n${issues.join("\n")}`);
}

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = parsed.data;
const configuredValues = [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT].filter(
  (value) => value !== undefined,
).length;

if (configuredValues !== 0 && configuredValues !== 3) {
  throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured together");
}
if (VAPID_PUBLIC_KEY !== undefined && VAPID_PRIVATE_KEY !== undefined) {
  try {
    const expectedPublicKey = Buffer.from(VAPID_PUBLIC_KEY, "base64url");
    const privateKey = Buffer.from(VAPID_PRIVATE_KEY, "base64url");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateKey);
    const derivedPublicKey = ecdh.getPublicKey(undefined, "uncompressed");
    if (
      expectedPublicKey.length !== 65 ||
      privateKey.length !== 32 ||
      !timingSafeEqual(expectedPublicKey, derivedPublicKey)
    ) {
      throw new Error("key mismatch");
    }
  } catch {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be a matching P-256 key pair");
  }
}

// Push is optional infrastructure: unrelated runtimes (mock, football gateway, CS2 catalog mode)
// must still start without VAPID configured. Only sending an actual push requires it.
export const pushConfig =
  VAPID_PUBLIC_KEY !== undefined && VAPID_PRIVATE_KEY !== undefined && VAPID_SUBJECT !== undefined
    ? { configured: true as const, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT }
    : { configured: false as const };
