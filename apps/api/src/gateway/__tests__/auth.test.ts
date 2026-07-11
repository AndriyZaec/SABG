import { describe, expect, it, vi } from "vitest";
import { authenticateWsUrl, issueToken, verifyToken } from "../auth.js";

describe("issueToken / verifyToken", () => {
  it("round-trips a valid token back to the issued userId", () => {
    const token = issueToken("user-1");
    expect(verifyToken(token)).toBe("user-1");
  });

  it("rejects a malformed token (no signature part)", () => {
    expect(verifyToken("not-a-real-token")).toBeUndefined();
  });

  it("rejects a token with a tampered signature", () => {
    const token = issueToken("user-1");
    const [payload] = token.split(".");
    expect(verifyToken(`${payload}.deadbeef`)).toBeUndefined();
  });

  it("rejects a token whose payload was swapped for a different user's payload but kept its own signature", () => {
    const tokenA = issueToken("user-a");
    const tokenB = issueToken("user-b");
    const [, signatureA] = tokenA.split(".");
    const [payloadB] = tokenB.split(".");
    expect(verifyToken(`${payloadB}.${signatureA}`)).toBeUndefined();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      const token = issueToken("user-1");
      vi.setSystemTime(new Date("2024-01-03T00:00:00.000Z")); // > 24h TTL later
      expect(verifyToken(token)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an empty string", () => {
    expect(verifyToken("")).toBeUndefined();
  });
});

describe("authenticateWsUrl", () => {
  it("extracts and verifies a token from a ?token= query param", () => {
    const token = issueToken("user-1");
    expect(authenticateWsUrl(`/ws?token=${token}`)).toBe("user-1");
  });

  it("returns undefined when no token is present", () => {
    expect(authenticateWsUrl("/ws")).toBeUndefined();
  });

  it("returns undefined for an invalid token in the query param", () => {
    expect(authenticateWsUrl("/ws?token=garbage")).toBeUndefined();
  });

  it("returns undefined for an undefined url", () => {
    expect(authenticateWsUrl(undefined)).toBeUndefined();
  });
});
