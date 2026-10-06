import { z } from "zod";

const AdminEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  ADMIN_PORT: z.coerce.number().int().positive().default(4174),
  ADMIN_PUBLIC_ORIGIN: z.string().url(),
  ADMIN_GITHUB_CLIENT_ID: z.string().trim().min(1),
  ADMIN_GITHUB_CLIENT_SECRET: z.string().min(1),
  ADMIN_GITHUB_ALLOWED_USER_IDS: z.string().trim().min(1),
  ADMIN_SESSION_SECRET: z.string().min(32),
  ADMIN_AUTH_MODE: z.enum(["github", "fixture"]).default("github"),
  ADMIN_CONTROL_MODE: z.enum(["live", "fixture"]).default("live"),
  CS2_CONTROL_URL: z.string().url().optional(),
  CS2_CONTROL_MACHINE_TOKEN: z.string().min(32).optional(),
});

export type AdminControlConfig =
  | { mode: "live"; baseUrl: string; machineToken: string }
  | { mode: "fixture" };

export interface AdminConfig {
  port: number;
  publicOrigin: string;
  githubClientId: string;
  githubClientSecret: string;
  allowedUserIds: Set<string>;
  sessionSecret: string;
  authMode: "github" | "fixture";
  control: AdminControlConfig;
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
  if (parsed.data.ADMIN_CONTROL_MODE === "fixture" &&
      (parsed.data.NODE_ENV !== "development" || !loopbackHosts.has(publicUrl.hostname))) {
    throw new Error("Invalid admin environment configuration:\n  - ADMIN_CONTROL_MODE: fixture mode requires explicit local development");
  }
  if (parsed.data.ADMIN_AUTH_MODE === "fixture" &&
      (parsed.data.NODE_ENV !== "development" || !loopbackHosts.has(publicUrl.hostname))) {
    throw new Error("Invalid admin environment configuration:\n  - ADMIN_AUTH_MODE: fixture mode requires explicit local development");
  }
  if (parsed.data.ADMIN_CONTROL_MODE === "live" &&
      (parsed.data.CS2_CONTROL_URL === undefined || parsed.data.CS2_CONTROL_MACHINE_TOKEN === undefined)) {
    throw new Error("Invalid admin environment configuration:\n  - CS2_CONTROL_URL and CS2_CONTROL_MACHINE_TOKEN are required in live mode");
  }

  const control: AdminControlConfig = parsed.data.ADMIN_CONTROL_MODE === "fixture"
    ? { mode: "fixture" }
    : {
        mode: "live",
        baseUrl: new URL(parsed.data.CS2_CONTROL_URL!).toString().replace(/\/$/u, ""),
        machineToken: parsed.data.CS2_CONTROL_MACHINE_TOKEN!,
      };

  return {
    port: parsed.data.ADMIN_PORT,
    publicOrigin: publicUrl.origin,
    githubClientId: parsed.data.ADMIN_GITHUB_CLIENT_ID,
    githubClientSecret: parsed.data.ADMIN_GITHUB_CLIENT_SECRET,
    allowedUserIds,
    sessionSecret: parsed.data.ADMIN_SESSION_SECRET,
    authMode: parsed.data.ADMIN_AUTH_MODE,
    control,
  };
}
