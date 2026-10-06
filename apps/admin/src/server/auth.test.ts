import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAdminApp } from "./app.js";
import type { AdminConfig } from "./config.js";
import { createFixtureControlClient } from "./control-client.js";
import type { GitHubOAuthClient, GitHubUser } from "./github.js";
import { createOperatorSession, openSession, sealSession, SESSION_COOKIE } from "./session.js";

const servers: Server[] = [];

function testConfig(allowedUserIds = new Set(["1234"])): AdminConfig {
  return {
    port: 0,
    publicOrigin: "https://admin.sabg.test",
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    allowedUserIds,
    sessionSecret: "a-test-session-secret-that-is-at-least-32-bytes",
    control: { mode: "fixture" },
  };
}

async function start(user: GitHubUser, config = testConfig()) {
  const github: GitHubOAuthClient = {
    authorizationUrl: (state) => `https://github.test/authorize?state=${state}`,
    complete: async () => user,
  };
  const server = createAdminApp({ config, github, control: createFixtureControlClient() }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server has no TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, config };
}

function cookiePair(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`Missing ${name} cookie`);
  return cookie.split(";", 1)[0]!;
}

async function oauthState(origin: string): Promise<{ state: string; cookie: string }> {
  const response = await fetch(`${origin}/auth/github`, { redirect: "manual" });
  const location = response.headers.get("location");
  if (location === null) throw new Error("Missing GitHub redirect");
  return {
    state: new URL(location).searchParams.get("state")!,
    cookie: cookiePair(response, "__Host-sabg_admin_oauth_state"),
  };
}

async function signIn(origin: string): Promise<string> {
  const { state, cookie } = await oauthState(origin);
  const response = await fetch(`${origin}/auth/github/callback?code=code&state=${state}`, {
    headers: { cookie },
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  return cookiePair(response, SESSION_COOKIE);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("admin authentication boundary", () => {
  it("rejects a GitHub user outside the allowlist", async () => {
    const { origin } = await start({ id: "9999", login: "outsider" });
    const { state, cookie } = await oauthState(origin);
    const response = await fetch(`${origin}/auth/github/callback?code=code&state=${state}`, {
      headers: { cookie },
      redirect: "manual",
    });

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().some((value) => value.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it("rechecks the allowlist on every authenticated request", async () => {
    const allowedUserIds = new Set(["1234"]);
    const { origin } = await start({ id: "1234", login: "operator" }, testConfig(allowedUserIds));
    const sessionCookie = await signIn(origin);
    expect((await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } })).status).toBe(200);

    allowedUserIds.delete("1234");
    expect((await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } })).status).toBe(401);
  });

  it("requires the configured Origin and session CSRF token to log out", async () => {
    const { origin, config } = await start({ id: "1234", login: "operator" });
    const sessionCookie = await signIn(origin);
    const sessionResponse = await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } });
    const session = await sessionResponse.json() as { csrfToken: string };

    const rejected = await fetch(`${origin}/auth/logout`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://attacker.test", "x-csrf-token": session.csrfToken },
    });
    expect(rejected.status).toBe(403);

    const accepted = await fetch(`${origin}/auth/logout`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: config.publicOrigin, "x-csrf-token": session.csrfToken },
    });
    expect(accepted.status).toBe(204);
    expect(accepted.headers.getSetCookie()).toContainEqual(expect.stringContaining(`${SESSION_COOKIE}=;`));
  });

  it("does not extend or accept an expired 12-hour session", () => {
    const config = testConfig();
    const issuedAt = Date.UTC(2026, 0, 1);
    const session = createOperatorSession("1234", "operator", issuedAt);
    const sealed = sealSession(session, config.sessionSecret);

    expect(openSession(sealed, config.sessionSecret, issuedAt + 12 * 60 * 60 * 1000 - 1)).toEqual(session);
    expect(openSession(sealed, config.sessionSecret, issuedAt + 12 * 60 * 60 * 1000)).toBeUndefined();
  });
});
