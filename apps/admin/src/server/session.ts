import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const SESSION_COOKIE = "__Host-sabg_admin_session";
export const OAUTH_STATE_COOKIE = "__Host-sabg_admin_oauth_state";
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const SESSION_VERSION = "v1";
const SESSION_AAD = Buffer.from("sabg-admin-session-v1", "utf8");

const OperatorSessionSchema = z.object({
  githubId: z.string().regex(/^\d+$/u),
  login: z.string().min(1).max(100),
  csrfToken: z.string().min(32),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type OperatorSession = z.infer<typeof OperatorSessionSchema>;

function sessionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function createOperatorSession(
  githubId: string,
  login: string,
  now = Date.now(),
): OperatorSession {
  const issuedAt = Math.floor(now / 1000);
  return {
    githubId,
    login,
    csrfToken: randomBytes(32).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + SESSION_LIFETIME_SECONDS,
  };
}

export function sealSession(session: OperatorSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  cipher.setAAD(SESSION_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SESSION_VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openSession(value: string, secret: string, now = Date.now()): OperatorSession | undefined {
  try {
    const [version, encodedIv, encodedPayload, encodedTag, extra] = value.split(".");
    if (version !== SESSION_VERSION || encodedIv === undefined || encodedPayload === undefined || encodedTag === undefined || extra !== undefined) {
      return undefined;
    }
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(SESSION_AAD);
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const session = OperatorSessionSchema.parse(JSON.parse(decrypted));
    return Math.floor(now / 1000) < session.expiresAt ? session : undefined;
  } catch {
    return undefined;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function secureCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSecureCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
