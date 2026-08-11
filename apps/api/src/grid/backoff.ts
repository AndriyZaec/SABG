// Shared error-backoff schedule for anything that polls Grid.gg in a loop — GridRecorder
// (recorder.ts) and the CS2 live poller (cs2/live-poller.ts) both need the same "how long to
// wait after N consecutive poll failures" answer, and duplicating the schedule invites the two
// from drifting apart for no reason.

/** Backoff schedule (ms) applied on consecutive poll failures, indexed by errorStreak - 1. */
export const POLL_ERROR_BACKOFF_MS = [1_000, 5_000, 10_000, 30_000] as const;

/** `errorStreak` is 1-indexed (the count of consecutive failures so far, including this one). */
export function nextBackoffMs(errorStreak: number): number {
  return POLL_ERROR_BACKOFF_MS[Math.min(errorStreak - 1, POLL_ERROR_BACKOFF_MS.length - 1)]!;
}
