import { gridConfig } from "./config/env.js";
import { GridGraphqlClient, type GridFetchResult, type GridGraphqlRequester } from "./graphql-client.js";
import { loadSeriesStateQuery } from "./query-loader.js";

export type { GridFetchResult } from "./graphql-client.js";

export class GridClient {
  private readonly graphql: GridGraphqlRequester;

  constructor(graphql?: GridGraphqlRequester) {
    this.graphql = graphql ?? new GridGraphqlClient({
      url: gridConfig.grid.graphqlUrl,
      apiKey: gridConfig.grid.apiKey,
      requestTimeoutMs: gridConfig.grid.requestTimeoutMs,
      rateLimitRetryMs: gridConfig.grid.rateLimitRetryMs,
      maxRateLimitRetries: gridConfig.grid.maxRateLimitRetries,
    });
  }

  async fetchSeriesState(signal?: AbortSignal): Promise<GridFetchResult> {
    const query = loadSeriesStateQuery(gridConfig.grid.queryFile, gridConfig.grid.seriesId);
    return this.graphql.request(query, {}, signal, { seriesId: gridConfig.grid.seriesId });
  }
}
