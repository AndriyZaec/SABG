import { z } from "zod";
import { gridConfig } from "../grid/config/env.js";
import { UpstreamApiError } from "../grid/errors.js";
import { GridGraphqlClient, type GridGraphqlRequester } from "../grid/graphql-client.js";

const TITLES_QUERY = `
  query Cs2Titles {
    titles {
      id
      name
      nameShortened
    }
  }
`;

const SERIES_QUERY = `
  query Cs2SeriesCatalog($after: String, $filter: SeriesFilter!, $first: Int!) {
    allSeries(
      after: $after
      filter: $filter
      first: $first
      orderBy: StartTimeScheduled
      orderDirection: ASC
    ) {
      edges {
        node {
          id
          format { name nameShortened }
          private
          productServiceLevels { productName serviceLevel }
          startTimeScheduled
          teams {
            baseInfo { id logoUrl name nameShortened }
          }
          tournament { id logoUrl name nameShortened }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

const GraphqlErrorSchema = z.object({ message: z.string() });
const TitlesResponseSchema = z.object({
  data: z.object({
    titles: z.array(z.object({ id: z.string().min(1), name: z.string(), nameShortened: z.string() })),
  }).optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
});
const SeriesNodeSchema = z.object({
  id: z.string().min(1),
  format: z.object({ name: z.string(), nameShortened: z.string() }),
  private: z.boolean(),
  productServiceLevels: z.array(z.object({
    productName: z.string(),
    serviceLevel: z.enum(["FULL", "LIMITED", "NONE"]),
  })),
  startTimeScheduled: z.string(),
  teams: z.array(z.object({
    baseInfo: z.object({
      id: z.string().min(1),
      logoUrl: z.string(),
      name: z.string().min(1),
      nameShortened: z.string().nullable().optional(),
    }),
  })),
  tournament: z.object({
    id: z.string().min(1),
    logoUrl: z.string(),
    name: z.string().min(1),
    nameShortened: z.string(),
  }),
});
const SeriesPageResponseSchema = z.object({
  data: z.object({
    allSeries: z.object({
      edges: z.array(z.object({ node: SeriesNodeSchema })),
      pageInfo: z.object({ endCursor: z.string().nullable(), hasNextPage: z.boolean() }),
    }),
  }).optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
});

export interface GridCatalogCompetition {
  gridTournamentId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface GridCatalogTeam {
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface GridCatalogSeries {
  gridSeriesId: string;
  format: number;
  scheduledStartTime: Date;
  competition: GridCatalogCompetition;
  teams: readonly GridCatalogTeam[];
  hasFullLiveData: boolean;
}

export interface GridCatalogWindow {
  from: Date;
  to: Date;
}

function graphqlData<T extends { data?: unknown; errors?: { message: string }[] }>(
  parsed: T,
  operation: string,
): NonNullable<T["data"]> {
  if (parsed.errors?.length) {
    throw new UpstreamApiError(`GRID Central Data ${operation} failed: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
  if (parsed.data === undefined) throw new UpstreamApiError(`GRID Central Data ${operation} returned no data`);
  return parsed.data as NonNullable<T["data"]>;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseFormat(...values: string[]): number | undefined {
  for (const value of values) {
    const match = value.match(/(\d+)/);
    const format = match?.[1] === undefined ? undefined : Number(match[1]);
    if (Number.isInteger(format) && format !== undefined && format >= 1 && format <= 7) return format;
  }
  return undefined;
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSeries(node: z.infer<typeof SeriesNodeSchema>): GridCatalogSeries | undefined {
  if (node.private || node.teams.length > 2) return undefined;
  const format = parseFormat(node.format.nameShortened, node.format.name);
  const scheduledStartTime = new Date(node.startTimeScheduled);
  if (
    format === undefined ||
    Number.isNaN(scheduledStartTime.getTime()) ||
    node.tournament.name.trim() === "" ||
    node.teams.some(({ baseInfo }) => baseInfo.name.trim() === "")
  ) {
    return undefined;
  }

  const teams = node.teams.map(({ baseInfo }) => {
    const shortName = optionalText(baseInfo.nameShortened);
    const logoUrl = optionalText(baseInfo.logoUrl);
    return {
      gridTeamId: baseInfo.id,
      name: baseInfo.name.trim(),
      ...(shortName !== undefined ? { shortName } : {}),
      ...(logoUrl !== undefined ? { logoUrl } : {}),
    };
  });
  if (new Set(teams.map((team) => team.gridTeamId)).size !== teams.length) return undefined;
  const competitionShortName = optionalText(node.tournament.nameShortened);
  const competitionLogoUrl = optionalText(node.tournament.logoUrl);

  return {
    gridSeriesId: node.id,
    format,
    scheduledStartTime,
    competition: {
      gridTournamentId: node.tournament.id,
      name: node.tournament.name.trim(),
      ...(competitionShortName !== undefined ? { shortName: competitionShortName } : {}),
      ...(competitionLogoUrl !== undefined ? { logoUrl: competitionLogoUrl } : {}),
    },
    teams,
    hasFullLiveData: node.productServiceLevels.some(
      (level) => ["livedata", "livedatafeed"].includes(normalizedName(level.productName)) && level.serviceLevel === "FULL",
    ),
  };
}

export class GridCentralDataClient {
  private readonly graphql: GridGraphqlRequester;
  private cs2TitleId: string | undefined;

  constructor(graphql?: GridGraphqlRequester) {
    if (graphql !== undefined) {
      this.graphql = graphql;
      return;
    }
    this.graphql = new GridGraphqlClient({
      url: gridConfig.grid.centralDataUrl,
      apiKey: gridConfig.grid.centralDataApiKey ?? gridConfig.grid.apiKey,
      requestTimeoutMs: gridConfig.grid.requestTimeoutMs,
      rateLimitRetryMs: gridConfig.grid.rateLimitRetryMs,
      maxRateLimitRetries: gridConfig.grid.maxRateLimitRetries,
    });
  }

  async resolveCs2TitleId(signal?: AbortSignal): Promise<string> {
    if (this.cs2TitleId !== undefined) return this.cs2TitleId;
    const response = await this.graphql.request(TITLES_QUERY, {}, signal, { operation: "titles" });
    const parsed = TitlesResponseSchema.safeParse(response.data);
    if (!parsed.success) throw new UpstreamApiError("GRID Central Data titles response is malformed", response.status, parsed.error);
    const { titles } = graphqlData(parsed.data, "titles");
    const matches = titles.filter((title) => {
      const names = [normalizedName(title.name), normalizedName(title.nameShortened)];
      return names.includes("counterstrike2") || names.includes("cs2");
    });
    if (matches.length !== 1) throw new UpstreamApiError(`GRID Central Data resolved ${matches.length} CS2 titles`);
    this.cs2TitleId = matches[0]!.id;
    return this.cs2TitleId;
  }

  async fetchSeries(window: GridCatalogWindow, signal?: AbortSignal): Promise<GridCatalogSeries[]> {
    if (Number.isNaN(window.from.getTime()) || Number.isNaN(window.to.getTime()) || window.from >= window.to) {
      throw new Error("GRID catalog window is invalid");
    }
    const titleId = await this.resolveCs2TitleId(signal);
    const series: GridCatalogSeries[] = [];
    let after: string | null = null;

    do {
      const response = await this.graphql.request(
        SERIES_QUERY,
        {
          after,
          first: 50,
          filter: {
            titleId,
            startTimeScheduled: { gte: window.from.toISOString(), lte: window.to.toISOString() },
            types: ["ESPORTS"],
            workflowStatuses: ["PUBLISHED"],
          },
        },
        signal,
        { operation: "allSeries", after },
      );
      const parsed = SeriesPageResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new UpstreamApiError("GRID Central Data allSeries response is malformed", response.status, parsed.error);
      }
      const page = graphqlData(parsed.data, "allSeries").allSeries;
      for (const edge of page.edges) {
        const normalized = normalizeSeries(edge.node);
        if (normalized !== undefined) series.push(normalized);
      }
      if (!page.pageInfo.hasNextPage) break;
      if (page.pageInfo.endCursor === null || page.pageInfo.endCursor === after) {
        throw new UpstreamApiError("GRID Central Data pagination did not advance");
      }
      after = page.pageInfo.endCursor;
    } while (true);

    return series;
  }
}
