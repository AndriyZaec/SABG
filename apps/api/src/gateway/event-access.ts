import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { EventAccessSessionResponse, EventAccessSignInRequest } from "@arena/contracts";
import express, { type Request, type RequestHandler, type Router } from "express";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "sabg_event_access";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_CODE_LENGTH = 512;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_CONCURRENT_VERIFICATIONS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_TRACKED_CLIENTS = 1_000;

interface FailedAttempts {
  count: number;
  resetAt: number;
}

export interface EventAccessOptions {
  codeHash?: string;
  sessionSecret: string;
  secureCookies: boolean;
  now?: () => number;
}

export interface EventAccess {
  router: Router;
  requireAccess: RequestHandler;
  authorizeWebSocket: (request: IncomingMessage) => EventAccessAuthorization;
}

export type EventAccessAuthorization =
  | { authorized: false }
  | { authorized: true; expiresAt?: number };

export async function hashEventAccessCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(code, salt, 32)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function isEventAccessCodeHash(value: string): boolean {
  return parseCodeHash(value) !== undefined;
}

export function createEventAccess(options: EventAccessOptions): EventAccess {
  const enabled = options.codeHash !== undefined;
  const now = options.now ?? Date.now;
  const failedAttempts = new Map<string, FailedAttempts>();
  let activeVerifications = 0;
  const router = express.Router();

  const sessionExpiry = (cookieHeader: string | undefined): number | undefined => {
    const value = readCookie(cookieHeader, COOKIE_NAME);
    if (value === undefined) return undefined;
    const [version, expiresText, suppliedSignature, ...extra] = value.split(".");
    if (version !== "v1" || expiresText === undefined || suppliedSignature === undefined || extra.length > 0) {
      return undefined;
    }
    const expiresAt = Number(expiresText);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) return undefined;
    const expectedSignature = signSession(expiresAt, options.sessionSecret);
    return safeEqual(suppliedSignature, expectedSignature) ? expiresAt : undefined;
  };
  const hasSession = (cookieHeader: string | undefined): boolean => !enabled || sessionExpiry(cookieHeader) !== undefined;

  router.get("/session", (req, res) => {
    const response: EventAccessSessionResponse = !enabled
      ? { status: "not_required" }
      : hasSession(req.headers.cookie)
        ? { status: "authenticated" }
        : { status: "unauthenticated" };
    res.json(response);
  });

  router.post("/session", async (req, res) => {
    if (!enabled) {
      const response: EventAccessSessionResponse = { status: "not_required" };
      res.json(response);
      return;
    }

    const clientId = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const attempts = reserveAttempt(failedAttempts, clientId, now());
    if (attempts.count > MAX_FAILED_ATTEMPTS || activeVerifications >= MAX_CONCURRENT_VERIFICATIONS) {
      res.status(429).json({ error: "too_many_attempts", message: "Try again later" });
      return;
    }

    const body = req.body as Partial<EventAccessSignInRequest> | undefined;
    const code = body?.code;
    activeVerifications += 1;
    let valid = false;
    try {
      valid = typeof code === "string" && code.length > 0 && code.length <= MAX_CODE_LENGTH
        ? await verifyEventAccessCode(code, options.codeHash!)
        : false;
    } finally {
      activeVerifications -= 1;
    }
    if (!valid) {
      res.status(401).json({ error: "invalid_access_code", message: "That access code is not valid" });
      return;
    }

    failedAttempts.delete(clientId);
    const expiresAt = now() + SESSION_TTL_SECONDS * 1_000;
    res.setHeader("set-cookie", serializeSessionCookie(expiresAt, options.sessionSecret, options.secureCookies));
    const response: EventAccessSessionResponse = { status: "authenticated" };
    res.json(response);
  });

  router.delete("/session", (_req, res) => {
    res.setHeader("set-cookie", clearSessionCookie(options.secureCookies));
    res.status(204).end();
  });

  const requireAccess: RequestHandler = (req, res, next) => {
    if (hasSession(req.headers.cookie)) {
      next();
      return;
    }
    res.status(401).json({ error: "event_access_required", message: "Enter the event access code" });
  };

  return {
    router,
    requireAccess,
    authorizeWebSocket: (request) => {
      if (!enabled) return { authorized: true };
      const expiresAt = sessionExpiry(request.headers.cookie);
      return expiresAt === undefined ? { authorized: false } : { authorized: true, expiresAt };
    },
  };
}

async function verifyEventAccessCode(code: string, encodedHash: string): Promise<boolean> {
  const parsed = parseCodeHash(encodedHash);
  if (parsed === undefined) return false;
  try {
    const actual = (await scrypt(code, parsed.salt, parsed.expected.length)) as Buffer;
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

function parseCodeHash(value: string): { salt: Buffer; expected: Buffer } | undefined {
  const [algorithm, saltText, expectedText, ...extra] = value.split("$");
  if (
    algorithm !== "scrypt" ||
    saltText === undefined ||
    expectedText === undefined ||
    extra.length > 0 ||
    !/^[A-Za-z0-9_-]{22}$/.test(saltText) ||
    !/^[A-Za-z0-9_-]{43}$/.test(expectedText)
  ) {
    return undefined;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(expectedText, "base64url");
  return salt.length === 16 && expected.length === 32 ? { salt, expected } : undefined;
}

function signSession(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`event-access:v1:${expiresAt}`).digest("base64url");
}

function serializeSessionCookie(expiresAt: number, secret: string, secure: boolean): string {
  const value = `v1.${expiresAt}.${signSession(expiresAt, secret)}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function reserveAttempt(store: Map<string, FailedAttempts>, clientId: string, timestamp: number): FailedAttempts {
  const existing = store.get(clientId);
  if (existing !== undefined && existing.resetAt > timestamp) {
    const reserved = { ...existing, count: existing.count + 1 };
    store.set(clientId, reserved);
    return reserved;
  }
  if (store.size >= MAX_TRACKED_CLIENTS) {
    for (const [key, attempts] of store) {
      if (attempts.resetAt <= timestamp) store.delete(key);
    }
    if (store.size >= MAX_TRACKED_CLIENTS) store.delete(store.keys().next().value as string);
  }
  const reserved = { count: 1, resetAt: timestamp + ATTEMPT_WINDOW_MS };
  store.set(clientId, reserved);
  return reserved;
}
