import axios, { type AxiosInstance, isAxiosError } from "axios";
import { RateLimitExhaustedError, UpstreamApiError } from "./errors.js";
import { logger } from "./logger.js";
import { sleep } from "../shared/sleep.js";

export interface GridFetchResult {
  status: number;
  headers: Record<string, unknown>;
  data: unknown;
}

export interface GridGraphqlClientOptions {
  url: string;
  apiKey: string;
  requestTimeoutMs: number;
  rateLimitRetryMs: number;
  maxRateLimitRetries: number;
}

export interface GridGraphqlRequester {
  request(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
    context?: Record<string, unknown>,
  ): Promise<GridFetchResult>;
}

function graphqlRateLimitDelay(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  for (const error of errors) {
    if (typeof error !== "object" || error === null) continue;
    const message = (error as { message?: unknown }).message;
    const extensions = (error as { extensions?: unknown }).extensions;
    const detail = typeof extensions === "object" && extensions !== null
      ? (extensions as { errorDetail?: unknown }).errorDetail
      : undefined;
    if (detail !== "ENHANCE_YOUR_CALM" && (
      typeof message !== "string" || !message.toLowerCase().includes("exceeded your rate limit")
    )) continue;
    if (typeof extensions !== "object" || extensions === null) return 0;
    const reset = (extensions as { rateLimitResetsIn?: unknown }).rateLimitResetsIn;
    if (typeof reset !== "string") return 0;
    const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(reset);
    if (match === null) return 0;
    return Math.ceil(
      (Number(match[1] ?? 0) * 60 * 60 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1_000,
    );
  }
  return undefined;
}

export class GridGraphqlClient implements GridGraphqlRequester {
  private readonly http: AxiosInstance;

  constructor(private readonly options: GridGraphqlClientOptions) {
    this.http = axios.create({
      baseURL: options.url,
      timeout: options.requestTimeoutMs,
      headers: {
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });
  }

  async request(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
    context: Record<string, unknown> = {},
  ): Promise<GridFetchResult> {
    for (let attempt = 1; attempt <= this.options.maxRateLimitRetries + 1; attempt++) {
      logger.info({ ...context, url: this.options.url, attempt }, "grid: request attempt");

      let response;
      try {
        response = await this.http.post("", { query, variables }, { signal });
      } catch (err) {
        const status = isAxiosError(err) ? err.response?.status : undefined;
        throw new UpstreamApiError(`Grid.gg request failed: ${(err as Error).message}`, status, err);
      }

      if (response.status === 429) {
        if (attempt > this.options.maxRateLimitRetries) {
          throw new RateLimitExhaustedError(
            `Grid.gg rate limit retries exhausted (${this.options.maxRateLimitRetries} consecutive 429s)`,
          );
        }
        logger.warn(
          { attempt, max: this.options.maxRateLimitRetries, retryAfterMs: this.options.rateLimitRetryMs },
          "grid: rate limited (429) — waiting and retrying",
        );
        await sleep(this.options.rateLimitRetryMs, signal);
        continue;
      }

      const graphqlRetryMs = graphqlRateLimitDelay(response.data);
      if (graphqlRetryMs !== undefined) {
        if (attempt > this.options.maxRateLimitRetries) {
          throw new RateLimitExhaustedError(
            `Grid.gg rate limit retries exhausted (${this.options.maxRateLimitRetries} consecutive GraphQL rate limits)`,
          );
        }
        const retryAfterMs = Math.max(this.options.rateLimitRetryMs, graphqlRetryMs);
        logger.warn(
          { attempt, max: this.options.maxRateLimitRetries, retryAfterMs },
          "grid: GraphQL rate limited — waiting",
        );
        await sleep(retryAfterMs, signal);
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

    throw new RateLimitExhaustedError("Grid.gg rate limit retries exhausted");
  }
}
