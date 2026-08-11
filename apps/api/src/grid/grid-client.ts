// HTTP caller for the Grid.gg live-data-feed series-state GraphQL endpoint. Owns the
// request/response cycle for a single poll attempt, including the in-band 429 retry loop
// (wait exactly GRID_RATE_LIMIT_RETRY_MS, retry the same request, cap at
// GRID_MAX_RATE_LIMIT_RETRIES consecutive retries).

import axios, { type AxiosInstance, isAxiosError } from "axios";
import { gridConfig } from "./config/env.js";
import { loadSeriesStateQuery } from "./query-loader.js";
import { logger } from "./logger.js";
import { RateLimitExhaustedError, UpstreamApiError } from "./errors.js";
import { sleep } from "../shared/sleep.js";

export interface GridFetchResult {
  status: number;
  headers: Record<string, unknown>;
  data: unknown;
}

export class GridClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: gridConfig.grid.graphqlUrl,
      timeout: gridConfig.grid.requestTimeoutMs,
      headers: {
        "x-api-key": gridConfig.grid.apiKey,
        "Content-Type": "application/json",
      },
      // Let us inspect non-2xx responses ourselves instead of throwing for every status.
      validateStatus: () => true,
    });
  }

  /**
   * POSTs the seriesState query. On HTTP 429, waits GRID_RATE_LIMIT_RETRY_MS and retries the
   * same request, up to GRID_MAX_RATE_LIMIT_RETRIES consecutive times. Throws
   * RateLimitExhaustedError if the cap is hit, or UpstreamApiError for any other non-2xx /
   * network failure.
   */
  async fetchSeriesState(signal?: AbortSignal): Promise<GridFetchResult> {
    const query = loadSeriesStateQuery(gridConfig.grid.queryFile, gridConfig.grid.seriesId);
    const maxRetries = gridConfig.grid.maxRateLimitRetries;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      logger.info(
        { url: gridConfig.grid.graphqlUrl, seriesId: gridConfig.grid.seriesId, attempt },
        "grid: request attempt",
      );

      let response;
      try {
        response = await this.http.post("", { query });
      } catch (err) {
        const status = isAxiosError(err) ? err.response?.status : undefined;
        throw new UpstreamApiError(`Grid.gg request failed: ${(err as Error).message}`, status, err);
      }

      if (response.status === 429) {
        if (attempt > maxRetries) {
          throw new RateLimitExhaustedError(
            `Grid.gg rate limit retries exhausted (${maxRetries} consecutive 429s) for series ${gridConfig.grid.seriesId}`,
          );
        }
        logger.warn(
          { attempt, max: maxRetries, retryAfterMs: gridConfig.grid.rateLimitRetryMs },
          "grid: rate limited (429) — waiting and retrying",
        );
        await sleep(gridConfig.grid.rateLimitRetryMs, signal);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new UpstreamApiError(`Grid.gg returned HTTP ${response.status}`, response.status, response.data);
      }

      return {
        status: response.status,
        headers: response.headers as Record<string, unknown>,
        data: response.data,
      };
    }

    // Unreachable: the loop always returns or throws.
    throw new RateLimitExhaustedError("Grid.gg rate limit retries exhausted");
  }
}
