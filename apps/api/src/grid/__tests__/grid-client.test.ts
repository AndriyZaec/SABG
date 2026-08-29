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
import { GridGraphqlClient } from "../graphql-client.js";
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
    expect(mocks.post).toHaveBeenCalledTimes(6);
  });

  it("throws UpstreamApiError for a non-429 non-2xx response", async () => {
    mocks.post.mockResolvedValue({ status: 500, headers: {}, data: { error: "boom" } });

    const client = new GridClient();
    await expect(client.fetchSeriesState()).rejects.toThrow(UpstreamApiError);
  });
});

describe("GridGraphqlClient.request", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    vi.mocked(sleep).mockClear();
  });

  it("retries an HTTP 200 GraphQL rate limit after its advertised reset", async () => {
    mocks.post
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          data: null,
          errors: [{
            message: "You have exceeded your rate limit, please try again later",
            extensions: { errorDetail: "ENHANCE_YOUR_CALM", rateLimitResetsIn: "PT35S" },
          }],
        },
      })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { data: { allSeries: {} } } });
    const client = new GridGraphqlClient({
      url: "https://example.test/graphql",
      apiKey: "test",
      requestTimeoutMs: 1_000,
      rateLimitRetryMs: 1_000,
      maxRateLimitRetries: 1,
    });

    await expect(client.request("query Test { allSeries { edges { node { id } } } }")).resolves.toMatchObject({
      status: 200,
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(35_000, undefined);
  });

  it("recognizes a message-only GraphQL rate limit", async () => {
    mocks.post
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { data: null, errors: [{ message: "You have exceeded your rate limit, please try again later" }] },
      })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { data: {} } });
    const client = new GridGraphqlClient({
      url: "https://example.test/graphql",
      apiKey: "test",
      requestTimeoutMs: 1_000,
      rateLimitRetryMs: 1_000,
      maxRateLimitRetries: 1,
    });

    await expect(client.request("query Test { titles { id } }")).resolves.toMatchObject({ status: 200 });
    expect(sleep).toHaveBeenCalledWith(1_000, undefined);
  });
});
