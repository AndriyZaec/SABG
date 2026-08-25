export const POLL_ERROR_BACKOFF_MS = [1_000, 5_000, 10_000, 30_000] as const;

export function nextBackoffMs(errorStreak: number): number {
  return POLL_ERROR_BACKOFF_MS[Math.min(errorStreak - 1, POLL_ERROR_BACKOFF_MS.length - 1)]!;
}
