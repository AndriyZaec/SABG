import { z } from "zod";

const AdminEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ADMIN_PORT: z.coerce.number().int().positive().default(4174),
  ADMIN_PUBLIC_ORIGIN: z.string().url(),
  ADMIN_GITHUB_CLIENT_ID: z.string().trim().min(1),
  ADMIN_GITHUB_CLIENT_SECRET: z.string().min(1),
  ADMIN_GITHUB_ALLOWED_USER_IDS: z.string().trim().min(1),
  ADMIN_SESSION_SECRET: z.string().min(32),
});

export interface AdminConfig {
  port: number;
  publicOrigin: string;
  githubClientId: string;
  githubClientSecret: string;
  allowedUserIds: Set<string>;
  sessionSecret: string;
}

export function readAdminConfig(environment: NodeJS.ProcessEnv): AdminConfig {
  const parsed = AdminEnvSchema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid admin environment configuration:\n${issues.join("\n")}`);
  }

  const allowedUserIds = new Set(
    parsed.data.ADMIN_GITHUB_ALLOWED_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean),
  );
  if ([...allowedUserIds].some((id) => !/^\d+$/u.test(id))) {
    throw new Error("Invalid admin environment configuration:\n  - ADMIN_GITHUB_ALLOWED_USER_IDS: expected comma-separated GitHub user IDs");
  }

  const publicUrl = new URL(parsed.data.ADMIN_PUBLIC_ORIGIN);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (publicUrl.protocol !== "https:" && (parsed.data.NODE_ENV === "production" || !loopbackHosts.has(publicUrl.hostname))) {
    throw new Error("Invalid admin environment configuration:\n  - ADMIN_PUBLIC_ORIGIN: HTTPS is required outside local development");
  }

  return {
    port: parsed.data.ADMIN_PORT,
    publicOrigin: publicUrl.origin,
    githubClientId: parsed.data.ADMIN_GITHUB_CLIENT_ID,
    githubClientSecret: parsed.data.ADMIN_GITHUB_CLIENT_SECRET,
    allowedUserIds,
    sessionSecret: parsed.data.ADMIN_SESSION_SECRET,
  };
}
