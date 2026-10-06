import { describe, expect, it } from "vitest";
import { readAdminConfig } from "./config.js";

const requiredEnvironment = {
  ADMIN_GITHUB_CLIENT_ID: "client-id",
  ADMIN_GITHUB_CLIENT_SECRET: "client-secret",
  ADMIN_GITHUB_ALLOWED_USER_IDS: "1234",
  ADMIN_SESSION_SECRET: "a-test-session-secret-that-is-at-least-32-bytes",
  CS2_CONTROL_URL: "http://app:4101",
  CS2_CONTROL_MACHINE_TOKEN: "a-test-machine-token-that-is-at-least-32-bytes",
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

  it("requires the internal control connection", () => {
    const { CS2_CONTROL_URL: _url, ...withoutUrl } = requiredEnvironment;
    expect(() => readAdminConfig({
      ...withoutUrl,
      ADMIN_PUBLIC_ORIGIN: "https://admin.sabg.fun",
    })).toThrow("CS2_CONTROL_URL");
  });
});
