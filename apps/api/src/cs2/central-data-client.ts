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

const SERIES_BY_ID_QUERY = `
  query Cs2SeriesById($id: ID!) {
    series(id: $id) {
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
`;

const GraphqlErrorSchema = z.object({ message: z.string() });
const TitlesResponseSchema = z.object({
  data: z.object({
    titles: z.array(z.object({ id: z.string().min(1), name: z.string(), nameShortened: z.string() })),
  }).nullable().optional(),
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
  }).nullable().optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
});
const SeriesByIdResponseSchema = z.object({
  data: z.object({ series: SeriesNodeSchema.nullable() }).nullable().optional(),
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

export type GridCatalogParticipantSlot =
  | { state: "tbd"; displayOrder: 1 | 2 }
  | { state: "known"; displayOrder: 1 | 2; team: GridCatalogTeam };

export interface GridCatalogSeries {
  gridSeriesId: string;
  format: number;
  scheduledStartTime: Date;
  competition: GridCatalogCompetition;
  participants: readonly [GridCatalogParticipantSlot, GridCatalogParticipantSlot];
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
  if (parsed.data === undefined || parsed.data === null) {
    throw new UpstreamApiError(`GRID Central Data ${operation} returned no data`);
  }
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

function isGridPlaceholderTeam(name: string): boolean {
  return /^tbd\d*$/u.test(normalizedName(name));
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

  const participants = ([0, 1] as const).map((index): GridCatalogParticipantSlot => {
    const baseInfo = node.teams[index]?.baseInfo;
    const displayOrder = (index + 1) as 1 | 2;
    if (baseInfo === undefined || isGridPlaceholderTeam(baseInfo.name)) return { state: "tbd", displayOrder };
    const shortName = optionalText(baseInfo.nameShortened);
    const logoUrl = optionalText(baseInfo.logoUrl);
    return {
      state: "known",
      displayOrder,
      team: {
        gridTeamId: baseInfo.id,
        name: baseInfo.name.trim(),
        ...(shortName !== undefined ? { shortName } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
      },
    };
  }) as [GridCatalogParticipantSlot, GridCatalogParticipantSlot];
  const knownTeamIds = participants.flatMap((slot) => slot.state === "known" ? [slot.team.gridTeamId] : []);
  if (new Set(knownTeamIds).size !== knownTeamIds.length) return undefined;
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
    participants,
    hasFullLiveData: node.productServiceLevels.some(
      (level) => ["livedata", "livedatafeed"].includes(normalizedName(level.productName)) && level.serviceLevel === "FULL",
    ),
  };
}

function validateCatalogWindow(window: GridCatalogWindow): void {
  if (Number.isNaN(window.from.getTime()) || Number.isNaN(window.to.getTime()) || window.from >= window.to) {
    throw new Error("GRID catalog window is invalid");
  }
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

  async fetchSeries(
    window: GridCatalogWindow,
    tournamentIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<GridCatalogSeries[]> {
    validateCatalogWindow(window);
    if (tournamentIds.length === 0) return [];
    return this.fetchMatchingSeries(window, tournamentIds, signal);
  }

  async discoverSeries(window: GridCatalogWindow, signal?: AbortSignal): Promise<GridCatalogSeries[]> {
    validateCatalogWindow(window);
    return this.fetchMatchingSeries(window, undefined, signal);
  }

  async discoverSeriesPage(
    window: GridCatalogWindow,
    first = 50,
    signal?: AbortSignal,
  ): Promise<GridCatalogSeries[]> {
    validateCatalogWindow(window);
    if (!Number.isInteger(first) || first < 1 || first > 50) throw new Error("GRID discovery page size must be 1-50");
    const titleId = await this.resolveCs2TitleId(signal);
    const response = await this.graphql.request(
      SERIES_QUERY,
      {
        after: null,
        first,
        filter: {
          titleId,
          startTimeScheduled: { gte: window.from.toISOString(), lte: window.to.toISOString() },
          types: ["ESPORTS"],
          workflowStatuses: ["PUBLISHED"],
        },
      },
      signal,
      { operation: "allSeries", after: null },
    );
    const parsed = SeriesPageResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new UpstreamApiError("GRID Central Data allSeries response is malformed", response.status, parsed.error);
    }
    return graphqlData(parsed.data, "allSeries").allSeries.edges
      .map(({ node }) => normalizeSeries(node))
      .filter((series): series is GridCatalogSeries => series !== undefined);
  }

  async fetchSeriesById(gridSeriesId: string, signal?: AbortSignal): Promise<GridCatalogSeries | undefined> {
    if (gridSeriesId.trim() === "") throw new Error("GRID Series ID is required");
    const response = await this.graphql.request(
      SERIES_BY_ID_QUERY,
      { id: gridSeriesId },
      signal,
      { operation: "series", gridSeriesId },
    );
    const parsed = SeriesByIdResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new UpstreamApiError("GRID Central Data series response is malformed", response.status, parsed.error);
    }
    const node = graphqlData(parsed.data, "series").series;
    return node === null ? undefined : normalizeSeries(node);
  }

  private async fetchMatchingSeries(
    window: GridCatalogWindow,
    tournamentIds: readonly string[] | undefined,
    signal?: AbortSignal,
  ): Promise<GridCatalogSeries[]> {
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
            ...(tournamentIds !== undefined ? { tournamentIds: { in: [...tournamentIds] } } : {}),
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
