import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  create: vi.fn(),
}));

vi.mock("axios", () => {
  mocks.create.mockReturnValue({ post: mocks.post });
  return {
    default: { create: mocks.create, isAxiosError: () => false },
    isAxiosError: () => false,
  };
});

vi.mock("../logger.js", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { logger };
});

vi.mock("../../shared/sleep.js", () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../query-loader.js", () => ({ loadSeriesStateQuery: () => "query { seriesState(id: \"28\") { valid } }" }));

import { GridClient } from "../grid-client.js";
import { sleep } from "../../shared/sleep.js";
import { RateLimitExhaustedError, UpstreamApiError } from "../errors.js";

describe("GridClient.fetchSeriesState", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    vi.mocked(sleep).mockClear();
  });

  it("retries once after a single 429 then returns the following 200, waiting the configured retry delay", async () => {
    mocks.post
      .mockResolvedValueOnce({ status: 429, headers: {}, data: {} })
      .mockResolvedValueOnce({ status: 200, headers: { "x-ratelimit-remaining": "10" }, data: { data: {} } });

    const client = new GridClient();
    const result = await client.fetchSeriesState();

    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
  });

  it("throws RateLimitExhaustedError after exhausting all consecutive-429 retries", async () => {
    mocks.post.mockResolvedValue({ status: 429, headers: {}, data: {} });

    const client = new GridClient();
    await expect(client.fetchSeriesState()).rejects.toThrow(RateLimitExhaustedError);
    // GRID_MAX_RATE_LIMIT_RETRIES defaults to 5 -> 1 initial + 5 retries = 6 calls.
    expect(mocks.post).toHaveBeenCalledTimes(6);
  });

  it("throws UpstreamApiError for a non-429 non-2xx response", async () => {
    mocks.post.mockResolvedValue({ status: 500, headers: {}, data: { error: "boom" } });

    const client = new GridClient();
    await expect(client.fetchSeriesState()).rejects.toThrow(UpstreamApiError);
  });
});
