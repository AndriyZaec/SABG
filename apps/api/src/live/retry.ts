// Ported verbatim from world-cup's utils/retry.ts.

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  retryOn?: (err: unknown) => boolean;
}

/**
 * Runs `fn`, retrying transient failures with jittered exponential backoff.
 * Non-transient errors (bad input, 4xx other than 429) are not retried.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 300, retryOn = isTransient } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !retryOn(err)) break;
      const backoff = baseMs * 2 ** attempt + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastErr;
}

function isTransient(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  const code = (err as { code?: string } | undefined)?.code;
  return code === "ECONNABORTED" || status === 429 || (status !== undefined && status >= 500 && status < 600);
}
