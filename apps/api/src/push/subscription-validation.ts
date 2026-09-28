import { ECDH } from "node:crypto";
import type { PushSubscriptionInput } from "../db/repositories/push-subscription.repository.js";

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_P256DH_LENGTH = 256;
const MAX_AUTH_LENGTH = 128;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const PUSH_SERVICE_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

function isAllowedPushService(hostname: string): boolean {
  return PUSH_SERVICE_HOSTS.has(hostname) || hostname.endsWith(".notify.windows.com");
}

function isValidP256dh(value: string): boolean {
  const key = Buffer.from(value, "base64url");
  if (key.length !== 65 || key[0] !== 4) return false;
  try {
    ECDH.convertKey(key, "prime256v1", undefined, undefined, "uncompressed");
    return true;
  } catch {
    return false;
  }
}

export function validatePushSubscription(input: PushSubscriptionInput): string | undefined {
  if (
    typeof input.endpoint !== "string" ||
    typeof input.p256dh !== "string" ||
    typeof input.auth !== "string"
  ) {
    return "endpoint, p256dh and auth must be strings";
  }
  if (input.endpoint.length === 0 || input.endpoint.length > MAX_ENDPOINT_LENGTH) {
    return "endpoint has an invalid length";
  }
  if (
    input.p256dh.length === 0 ||
    input.p256dh.length > MAX_P256DH_LENGTH ||
    !BASE64_URL.test(input.p256dh) ||
    !isValidP256dh(input.p256dh)
  ) {
    return "p256dh must be an uncompressed P-256 public key";
  }
  if (
    input.auth.length === 0 ||
    input.auth.length > MAX_AUTH_LENGTH ||
    !BASE64_URL.test(input.auth) ||
    Buffer.from(input.auth, "base64url").length !== 16
  ) {
    return "auth must be a 16-byte URL-safe base64 secret";
  }

  try {
    const endpoint = new URL(input.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.hash !== "" ||
      (endpoint.port !== "" && endpoint.port !== "443") ||
      !isAllowedPushService(endpoint.hostname)
    ) {
      return "endpoint is not a supported browser push service";
    }
  } catch {
    return "endpoint must be a valid URL";
  }

  return undefined;
}

export function canonicalPushEndpoint(endpoint: string): string {
  return new URL(endpoint).toString();
}
