import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import express from "express";
import type { AdminConfig } from "./config.js";
import type { GitHubOAuthClient } from "./github.js";
import {
  clearSecureCookie,
  createOperatorSession,
  OAUTH_STATE_COOKIE,
  openSession,
  readCookie,
  sealSession,
  secureCookie,
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  type OperatorSession,
} from "./session.js";

const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;

function sameSecret(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function authenticatedSession(request: Request, config: AdminConfig): OperatorSession | undefined {
  const sealed = readCookie(request.get("cookie"), SESSION_COOKIE);
  if (sealed === undefined) return undefined;
  const session = openSession(sealed, config.sessionSecret);
  return session !== undefined && config.allowedUserIds.has(session.githubId) ? session : undefined;
}

export function createAdminApp(options: { config: AdminConfig; github: GitHubOAuthClient }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "same-origin");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    next();
  });

  app.get("/auth/github", (_request, response) => {
    const state = randomBytes(32).toString("base64url");
    response.append("set-cookie", secureCookie(OAUTH_STATE_COOKIE, state, OAUTH_STATE_LIFETIME_SECONDS));
    response.redirect(302, options.github.authorizationUrl(state));
  });

  app.get("/auth/github/callback", async (request, response) => {
    const code = queryString(request.query.code);
    const state = queryString(request.query.state);
    const expectedState = readCookie(request.get("cookie"), OAUTH_STATE_COOKIE);
    response.append("set-cookie", clearSecureCookie(OAUTH_STATE_COOKIE));
    if (code === undefined || !sameSecret(state, expectedState)) {
      response.status(400).json({ error: "bad_request", message: "GitHub sign-in request is invalid or expired" });
      return;
    }

    try {
      const user = await options.github.complete(code);
      if (!options.config.allowedUserIds.has(user.id)) {
        response.status(403).json({ error: "forbidden", message: "This GitHub account is not allowed" });
        return;
      }
      const session = createOperatorSession(user.id, user.login);
      response.append(
        "set-cookie",
        secureCookie(SESSION_COOKIE, sealSession(session, options.config.sessionSecret), SESSION_LIFETIME_SECONDS),
      );
      response.redirect(302, "/");
    } catch {
      response.status(502).json({ error: "github_unavailable", message: "GitHub sign-in could not be completed" });
    }
  });

  app.get("/api/session", (request, response) => {
    const session = authenticatedSession(request, options.config);
    if (session === undefined) {
      response.status(401).json({ error: "unauthorized", message: "Sign in with an allowed GitHub account" });
      return;
    }
    response.json({
      operator: { id: session.githubId, login: session.login },
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    });
  });

  app.post("/auth/logout", (request, response) => {
    const session = authenticatedSession(request, options.config);
    if (session === undefined) {
      response.status(401).json({ error: "unauthorized", message: "No active operator session" });
      return;
    }
    if (request.get("origin") !== options.config.publicOrigin || !sameSecret(request.get("x-csrf-token"), session.csrfToken)) {
      response.status(403).json({ error: "forbidden", message: "Valid Origin and CSRF token required" });
      return;
    }
    response.append("set-cookie", clearSecureCookie(SESSION_COOKIE));
    response.status(204).end();
  });

  return app;
}
