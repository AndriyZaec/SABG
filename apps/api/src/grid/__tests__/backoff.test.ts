import { describe, expect, it } from "vitest";
import { POLL_ERROR_BACKOFF_MS, nextBackoffMs } from "../backoff.js";

describe("nextBackoffMs", () => {
  it("walks the schedule for the first N consecutive failures", () => {
    expect(nextBackoffMs(1)).toBe(POLL_ERROR_BACKOFF_MS[0]);
    expect(nextBackoffMs(2)).toBe(POLL_ERROR_BACKOFF_MS[1]);
    expect(nextBackoffMs(3)).toBe(POLL_ERROR_BACKOFF_MS[2]);
    expect(nextBackoffMs(4)).toBe(POLL_ERROR_BACKOFF_MS[3]);
  });

  it("clamps to the last tier past the schedule's length", () => {
    const last = POLL_ERROR_BACKOFF_MS[POLL_ERROR_BACKOFF_MS.length - 1];
    expect(nextBackoffMs(5)).toBe(last);
    expect(nextBackoffMs(100)).toBe(last);
  });
});
