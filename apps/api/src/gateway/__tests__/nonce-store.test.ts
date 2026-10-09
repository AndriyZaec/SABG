import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("nonce store", () => {
  let store: typeof import("../nonce-store.js");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.resetModules();
    store = await import("../nonce-store.js");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("accepts a nonce only once and rejects it at the TTL boundary", () => {
    const challenge = store.issueNonce("wallet-1", "test")!;
    expect(store.consumeNonce("wallet-1", challenge.message)).toBe(true);
    expect(store.consumeNonce("wallet-1", challenge.message)).toBe(false);

    const expiring = store.issueNonce("wallet-2", "test")!;
    vi.setSystemTime(5 * 60 * 1000);
    expect(store.consumeNonce("wallet-2", expiring.message)).toBe(false);
  });

  it("bounds outstanding nonces without evicting active wallets", () => {
    const first = store.issueNonce("wallet-0", "test")!;
    for (let index = 1; index < 10_000; index += 1) store.issueNonce(`wallet-${index}`, "test");
    expect(store.issueNonce("overflow", "test")).toBeUndefined();
    expect(store.consumeNonce("wallet-0", first.message)).toBe(true);
    expect(store.issueNonce("overflow", "test")).toMatchObject({ message: expect.any(String) });
  });

  it("allows replacing a wallet's nonce even at capacity", () => {
    for (let index = 0; index < 10_000; index += 1) store.issueNonce(`wallet-${index}`, "test");
    const replacement = store.issueNonce("wallet-0", "test")!;
    expect(replacement).toMatchObject({ message: expect.any(String) });
    expect(store.consumeNonce("wallet-0", replacement.message)).toBe(true);
  });

  it("releases capacity after outstanding nonces expire", () => {
    for (let index = 0; index < 10_000; index += 1) store.issueNonce(`wallet-${index}`, "test");
    expect(store.issueNonce("overflow", "test")).toBeUndefined();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(store.issueNonce("overflow", "test")).toMatchObject({ message: expect.any(String) });
  });

  it("requires the full canonical message and preserves the challenge after a mismatch", () => {
    const challenge = store.issueNonce("wallet-1", "app.sabg.fun")!;
    expect(challenge.expiresAt).toBe("1970-01-01T00:05:00.000Z");
    expect(challenge.message).toContain("app.sabg.fun wants you to sign in");
    expect(challenge.message).toContain("Issued At: 1970-01-01T00:00:00.000Z");
    expect(challenge.message).toContain(`Expiration Time: ${challenge.expiresAt}`);
    expect(store.consumeNonce("wallet-1", `Nonce: ${challenge.nonce}`)).toBe(false);
    expect(store.consumeNonce("wallet-1", challenge.message + "\n")).toBe(false);
    expect(store.consumeNonce("wallet-1", challenge.message)).toBe(true);
  });
});
