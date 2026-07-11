// Minimal session-token auth (scope decision: no wallet-signature verification yet). POST
// /auth/wallet (rest.ts) upserts a User by wallet address and issues a token here; REST
// middleware and the WS connection handler both call `verifyToken` to identify the player. No
// JWT library — an HMAC-SHA256-signed `userId.expiry` payload needs nothing more and adds no
// dependency.
//
// Seam for later: real wallet sign-in verifies a `tweetnacl` signature over a server-issued nonce
// before ever calling `issueToken` — that check slots in ahead of the
// `userRepository.upsertByWallet` call in rest.ts's `/auth/wallet` handler; nothing here needs to
// change when it lands.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Uuid } from "@arena/contracts";
import { gatewayConfig } from "./config.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — a dev-scale session length, not a spec requirement.

function sign(payload: string): string {
  return createHmac("sha256", gatewayConfig.auth.secret).update(payload).digest("hex");
}

/** Issues an opaque session token encoding `userId` + an expiry, HMAC-signed against tampering. */
export function issueToken(userId: Uuid): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  const signature = sign(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature}`;
}

/** Verifies a token's signature and expiry, returning the encoded `userId` if valid. */
export function verifyToken(token: string): Uuid | undefined {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return undefined;

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return undefined;
  }

  const expected = sign(payload);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return undefined;

  const [userId, expiresAtStr] = payload.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return undefined;

  return userId;
}

/** An Express `Request` after `requireAuth` has attached the authenticated user's id. */
export type AuthedRequest = Request & { userId: Uuid };

/** Express middleware: reads `Authorization: Bearer <token>`, 401s if missing/invalid. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const userId = token ? verifyToken(token) : undefined;
  if (!userId) {
    res.status(401).json({ error: "unauthorized", message: "missing or invalid session token" });
    return;
  }
  (req as AuthedRequest).userId = userId;
  next();
}

/**
 * WS-connection auth: browsers cannot set custom headers on the WebSocket upgrade, so the token
 * travels as a query param (`ws://host/ws?token=...`) — read from the raw request URL at
 * `WebSocketServer`'s `connection` event.
 */
export function authenticateWsUrl(requestUrl: string | undefined): Uuid | undefined {
  if (!requestUrl) return undefined;
  const token = new URL(requestUrl, "http://placeholder").searchParams.get("token");
  return token ? verifyToken(token) : undefined;
}
