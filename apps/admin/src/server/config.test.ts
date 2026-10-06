import { describe, expect, it } from "vitest";
import { readAdminConfig } from "./config.js";

const requiredEnvironment = {
  ADMIN_GITHUB_CLIENT_ID: "client-id",
  ADMIN_GITHUB_CLIENT_SECRET: "client-secret",
  ADMIN_GITHUB_ALLOWED_USER_IDS: "1234",
  ADMIN_SESSION_SECRET: "a-test-session-secret-that-is-at-least-32-bytes",
};

describe("admin config", () => {
  it("requires HTTPS in production but permits local HTTP during development", () => {
    expect(() => readAdminConfig({
      ...requiredEnvironment,
      NODE_ENV: "production",
      ADMIN_PUBLIC_ORIGIN: "http://admin.sabg.fun",
    })).toThrow("HTTPS is required outside local development");

    expect(readAdminConfig({
      ...requiredEnvironment,
      NODE_ENV: "development",
      ADMIN_PUBLIC_ORIGIN: "http://127.0.0.1:4174",
    }).publicOrigin).toBe("http://127.0.0.1:4174");
  });
});
