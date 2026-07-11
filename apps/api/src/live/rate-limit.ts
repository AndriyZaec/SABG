// Ported verbatim from world-cup's utils/rate-limit.ts. Global rate-limit budget tracked from
// TxODDS response headers, consulted by the stream worker's reconnect loop so it can back off
// before the API starts rejecting calls.

export const RateLimitState = {
  /** Epoch ms until which no request should be made (from Retry-After). */
  retryAfterUntil: 0,
  /** Last seen X-RateLimit-Remaining value. */
  remaining: Infinity,
};

/** Parse rate-limit headers from an axios response/error and update {@link RateLimitState}. */
export function ingestHeaders(headers: Record<string, unknown> | undefined): void {
  if (!headers) return;

  const retryAfterRaw = headers["retry-after"];
  const retryAfter = Number(retryAfterRaw);
  if (!Number.isNaN(retryAfter) && retryAfter > 0) {
    RateLimitState.retryAfterUntil = Date.now() + retryAfter * 1000;
  }

  const remainingRaw = headers["x-ratelimit-remaining"];
  const remaining = Number(remainingRaw);
  if (!Number.isNaN(remaining) && remainingRaw !== undefined) {
    RateLimitState.remaining = remaining;
  }
}
