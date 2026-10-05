import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import type {
  Cs2SeriesDetail,
  Cs2SeriesLifecycle,
  Cs2SeriesMapSummary,
  Cs2SeriesParticipant,
  Cs2SeriesSummary,
  Uuid,
} from "@arena/contracts";
import { cs2CatalogConfig } from "../../cs2/catalog-config.js";
import { forecastArenas } from "../../cs2/arena-forecast.js";
import { catalogLifecycleOnRead } from "../../cs2/catalog-lifecycle.js";
import type { Cs2SeriesCandidate } from "../../cs2/next-series.js";
import { db } from "../client.js";
import { arenas, cs2Competitions, cs2SeriesFollows, cs2SeriesParticipants, cs2Teams, matches, series } from "../schema.js";
import { matchRepository } from "./match.repository.js";
import { CS2_AUTOPILOT_SETTING, settingsRepository } from "./settings.repository.js";
import { reconcileSeriesParticipants } from "./cs2-participant-lifecycle.repository.js";

export interface Cs2CatalogCompetitionInput {
  gridTournamentId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface Cs2CatalogTeamInput {
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export type Cs2CatalogParticipantInput =
  | { state: "tbd"; displayOrder: 1 | 2 }
  | { state: "known"; displayOrder: 1 | 2; team: Cs2CatalogTeamInput };

export interface Cs2CatalogSeriesInput {
  gridSeriesId: string;
  competition: Cs2CatalogCompetitionInput;
  format: number;
  scheduledStartTime: Date;
  lifecycle: Cs2SeriesLifecycle;
  isSupported: boolean;
  participants: readonly [Cs2CatalogParticipantInput, Cs2CatalogParticipantInput];
}

function validateInput(input: Cs2CatalogSeriesInput): void {
  const text = [input.gridSeriesId, input.competition.gridTournamentId, input.competition.name];
  if (
    text.some((value) => value.trim() === "") ||
    !Number.isInteger(input.format) ||
    input.format < 1 ||
    input.format > 7 ||
    Number.isNaN(input.scheduledStartTime.getTime()) ||
    input.participants[0].displayOrder !== 1 ||
    input.participants[1].displayOrder !== 2 ||
    input.participants.some((slot) => slot.state === "known" && (
      slot.team.gridTeamId.trim() === "" || slot.team.name.trim() === ""
    )) ||
    new Set(input.participants.flatMap((slot) => slot.state === "known" ? [slot.team.gridTeamId] : [])).size !==
      input.participants.filter((slot) => slot.state === "known").length
  ) {
    throw new Error(`CS2 catalog series ${input.gridSeriesId || "<unknown>"} is invalid`);
  }
}

interface CatalogReadOptions {
  tournamentIds?: readonly string[];
  runningSeriesId?: Uuid | undefined;
}

async function readSupportedSeries(
  tournamentIds: readonly string[],
  options: { id?: Uuid; runningSeriesId?: Uuid | undefined } = {},
): Promise<Array<Cs2SeriesSummary & { mapNames: string[]; streamUrl: string | null }>> {
  if (tournamentIds.length === 0) return [];
  const catalogRows = await db
    .select({
      id: series.id,
      format: series.format,
      scheduledStartTime: series.scheduledStartTime,
      lifecycle: series.catalogLifecycle,
      mapNames: series.mapNames,
      streamUrl: series.streamUrl,
      competitionName: cs2Competitions.name,
      competitionShortName: cs2Competitions.shortName,
      competitionLogoUrl: cs2Competitions.logoUrl,
    })
    .from(series)
    .innerJoin(cs2Competitions, eq(series.competitionId, cs2Competitions.id))
    .where(and(
      eq(series.isSupported, true),
      inArray(cs2Competitions.gridTournamentId, [...tournamentIds]),
      options.id === undefined ? undefined : eq(series.id, options.id),
    ))
    .orderBy(asc(series.scheduledStartTime));
  if (catalogRows.length === 0) return [];
  // Forecast over the whole tournament, so one series' answer accounts for the others.
  const now = new Date().toISOString();
  const forecast = forecastArenas(await cs2CatalogRepository.listAutopilotCandidates(tournamentIds), now, {
    autopilotEnabled: await settingsRepository.isEnabled(CS2_AUTOPILOT_SETTING),
    ...(options.runningSeriesId !== undefined ? { runningSeriesId: options.runningSeriesId } : {}),
  });

  const participantRows = await db
    .select({
      seriesId: cs2SeriesParticipants.seriesId,
      displayOrder: cs2SeriesParticipants.displayOrder,
      seriesScore: cs2SeriesParticipants.score,
      teamId: cs2Teams.id,
      teamName: cs2Teams.name,
      teamShortName: cs2Teams.shortName,
      teamLogoUrl: cs2Teams.logoUrl,
    })
    .from(cs2SeriesParticipants)
    .innerJoin(cs2Teams, eq(cs2SeriesParticipants.teamId, cs2Teams.id))
    .where(inArray(cs2SeriesParticipants.seriesId, catalogRows.map((row) => row.id)))
    .orderBy(asc(cs2SeriesParticipants.displayOrder));

  const participantsBySeries = new Map<Uuid, [Cs2SeriesParticipant, Cs2SeriesParticipant]>();
  for (const row of participantRows) {
    if (row.displayOrder !== 1 && row.displayOrder !== 2) {
      throw new Error(`CS2 series ${row.seriesId} has invalid participant order ${row.displayOrder}`);
    }
    const participants = participantsBySeries.get(row.seriesId) ?? [
      { state: "tbd", displayOrder: 1, seriesScore: null },
      { state: "tbd", displayOrder: 2, seriesScore: null },
    ];
    participants[row.displayOrder - 1] = {
      state: "known",
      displayOrder: row.displayOrder,
      team: {
        id: row.teamId,
        name: row.teamName,
        ...(row.teamShortName !== null ? { shortName: row.teamShortName } : {}),
        ...(row.teamLogoUrl !== null ? { logoUrl: row.teamLogoUrl } : {}),
      },
      seriesScore: row.seriesScore,
    };
    participantsBySeries.set(row.seriesId, participants);
  }

  return catalogRows.map((row) => ({
    id: row.id,
    arena: forecast.get(row.id) ?? "none",
    participants: participantsBySeries.get(row.id) ?? [
      { state: "tbd", displayOrder: 1, seriesScore: null },
      { state: "tbd", displayOrder: 2, seriesScore: null },
    ],
    competition: {
      name: row.competitionName,
      ...(row.competitionShortName !== null ? { shortName: row.competitionShortName } : {}),
      ...(row.competitionLogoUrl !== null ? { logoUrl: row.competitionLogoUrl } : {}),
    },
    format: row.format,
    scheduledStartTime: row.scheduledStartTime.toISOString(),
    lifecycle: catalogLifecycleOnRead(row.lifecycle, row.scheduledStartTime.toISOString(), now, row.id === options.runningSeriesId),
    mapNames: row.mapNames ?? [],
    streamUrl: row.streamUrl,
  }));
}

export const cs2CatalogRepository = {
  /**
   * Marks unsupported the not-yet-run `active` series of these tournaments, scheduled inside the window, that GRID
   * no longer publishes. The next sync that sees one again restores `is_supported` from its live-data level.
   */
  async withdrawUnpublishedSeries(
    tournamentIds: readonly string[],
    window: { from: Date; to: Date },
    publishedGridSeriesIds: readonly string[],
  ): Promise<number> {
    if (tournamentIds.length === 0) return 0;
    const competitionIds = db
      .select({ id: cs2Competitions.id })
      .from(cs2Competitions)
      .where(inArray(cs2Competitions.gridTournamentId, [...tournamentIds]));
    const rows = await db
      .update(series)
      .set({ isSupported: false })
      .where(and(
        eq(series.status, "active"),
        eq(series.isSupported, true),
        inArray(series.competitionId, competitionIds),
        gte(series.scheduledStartTime, window.from),
        lte(series.scheduledStartTime, window.to),
        publishedGridSeriesIds.length > 0 ? notInArray(series.gridSeriesId, [...publishedGridSeriesIds]) : undefined,
        // A series that already ran keeps its row as is: its arenas and refunds don't depend on the catalog.
        sql`not exists (select 1 from ${arenas} inner join ${matches} on ${matches.id} = ${arenas.matchId} where ${matches.seriesId} = ${series.id})`,
      ))
      .returning({ id: series.id });
    return rows.length;
  },

  /** `active` series of the configured tournaments that already ran an arena, for the autopilot's resume. */
  async listActiveRunSeries(
    tournamentIds: readonly string[] = cs2CatalogConfig.tournamentIds,
  ): Promise<{ seriesId: Uuid; gridSeriesId: string; scheduledStartTime: string; hasOpenArena: boolean }[]> {
    if (tournamentIds.length === 0) return [];
    const arenaOfSeries = (open: boolean) =>
      sql<boolean>`exists (select 1 from ${arenas} inner join ${matches} on ${matches.id} = ${arenas.matchId} where ${matches.seriesId} = ${series.id}${open ? sql` and ${inArray(arenas.status, ["lobby", "live"])}` : sql``})`;
    const rows = await db
      .select({
        seriesId: series.id,
        gridSeriesId: series.gridSeriesId,
        scheduledStartTime: series.scheduledStartTime,
        hasOpenArena: arenaOfSeries(true),
      })
      .from(series)
      .innerJoin(cs2Competitions, eq(series.competitionId, cs2Competitions.id))
      .where(and(
        eq(series.status, "active"),
        inArray(cs2Competitions.gridTournamentId, [...tournamentIds]),
        arenaOfSeries(false),
      ))
      .orderBy(asc(series.scheduledStartTime));
    return rows.map((row) => ({ ...row, scheduledStartTime: row.scheduledStartTime.toISOString() }));
  },

  async listAutopilotCandidates(
    tournamentIds: readonly string[] = cs2CatalogConfig.tournamentIds,
  ): Promise<Cs2SeriesCandidate[]> {
    if (tournamentIds.length === 0) return [];
    // Only known slots have participant rows, and (series_id, team_id) is the key, so 2 rows means two distinct teams.
    const knownTeams = sql<number>`(select count(*) from ${cs2SeriesParticipants} where ${cs2SeriesParticipants.seriesId} = ${series.id})::int`;
    const followerCount = sql<number>`(select count(*) from ${cs2SeriesFollows} where ${cs2SeriesFollows.seriesId} = ${series.id})::int`;
    const hasArena = sql<boolean>`exists (select 1 from ${arenas} inner join ${matches} on ${matches.id} = ${arenas.matchId} where ${matches.seriesId} = ${series.id})`;
    const rows = await db
      .select({
        seriesId: series.id,
        scheduledStartTime: series.scheduledStartTime,
        priority: series.priority,
        skipRequested: series.skipRequested,
        status: series.status,
        format: series.format,
        isSupported: series.isSupported,
        knownTeams,
        followerCount,
        hasArena,
      })
      .from(series)
      .innerJoin(cs2Competitions, eq(series.competitionId, cs2Competitions.id))
      .where(inArray(cs2Competitions.gridTournamentId, [...tournamentIds]));
    return rows.map((row) => ({
      seriesId: row.seriesId,
      scheduledStartTime: row.scheduledStartTime.toISOString(),
      priority: row.priority,
      followerCount: row.followerCount,
      selectable: row.isSupported && row.knownTeams === 2,
      status: row.status,
      hasArena: row.hasArena,
      skipRequested: row.skipRequested,
      format: row.format,
    }));
  },

  async listSupported(options: CatalogReadOptions = {}): Promise<Cs2SeriesSummary[]> {
    const { tournamentIds = cs2CatalogConfig.tournamentIds, runningSeriesId } = options;
    const rows = await readSupportedSeries(tournamentIds, { runningSeriesId });
    return rows.map(({ mapNames: _mapNames, streamUrl: _streamUrl, ...summary }) => summary);
  },

  async findSupportedById(id: Uuid, options: CatalogReadOptions = {}): Promise<Cs2SeriesSummary | undefined> {
    const { tournamentIds = cs2CatalogConfig.tournamentIds, runningSeriesId } = options;
    const [catalogSeries] = await readSupportedSeries(tournamentIds, { id, runningSeriesId });
    if (catalogSeries === undefined) return undefined;
    const { mapNames: _mapNames, streamUrl: _streamUrl, ...summary } = catalogSeries;
    return summary;
  },

  async findSupportedDetailById(id: Uuid, options: CatalogReadOptions = {}): Promise<Cs2SeriesDetail | undefined> {
    const { tournamentIds = cs2CatalogConfig.tournamentIds, runningSeriesId } = options;
    const [catalogSeries] = await readSupportedSeries(tournamentIds, { id, runningSeriesId });
    if (catalogSeries === undefined) return undefined;
    const { streamUrl, ...catalogDetail } = catalogSeries;
    const { mapNames } = catalogDetail;

    const seriesMatches = await matchRepository.listBySeriesId(id);
    if (seriesMatches.some((match) => match.discipline !== "cs2")) {
      throw new Error(`CS2 series ${id} contains a non-CS2 match`);
    }
    const cs2Matches = seriesMatches.filter((match) => match.discipline === "cs2");
    const arenaRows = cs2Matches.length === 0
      ? []
      : await db
          .select({
            id: arenas.id,
            matchId: arenas.matchId,
            status: arenas.status,
            activePlayersCount: arenas.activePlayersCount,
            entryFeeLamports: arenas.entryFeeLamports,
            prizePoolLamports: arenas.prizePoolLamports,
          })
          .from(arenas)
          .where(inArray(arenas.matchId, cs2Matches.map((match) => match.id)));

    const arenasByMatchId = new Map<Uuid, (typeof arenaRows)[number]>();
    for (const arena of arenaRows) {
      if (arenasByMatchId.has(arena.matchId)) {
        throw new Error(`CS2 match ${arena.matchId} has multiple Arenas`);
      }
      arenasByMatchId.set(arena.matchId, arena);
    }

    const maps: Cs2SeriesMapSummary[] = Array.from(
      { length: catalogSeries.format },
      (_, index) => ({ state: "pending", seriesMatchIndex: index + 1, mapName: mapNames[index] }),
    );
    for (const match of cs2Matches) {
      if (match.seriesMatchIndex < 1 || match.seriesMatchIndex > catalogSeries.format) {
        throw new Error(`CS2 match ${match.id} has invalid Series map index ${match.seriesMatchIndex}`);
      }
      const arena = arenasByMatchId.get(match.id);
      if (arena === undefined) continue;
      const [firstTeamScore, secondTeamScore] = match.teamScores;
      maps[match.seriesMatchIndex - 1] = {
        state: arena.status,
        seriesMatchIndex: match.seriesMatchIndex,
        mapName: mapNames[match.seriesMatchIndex - 1],
        matchId: match.id,
        teams: [
          { teamId: firstTeamScore.teamId, score: firstTeamScore.score },
          { teamId: secondTeamScore.teamId, score: secondTeamScore.score },
        ],
        arena: {
          id: arena.id,
          activePlayersCount: arena.activePlayersCount,
          entryFeeLamports: arena.entryFeeLamports,
          prizePoolLamports: arena.prizePoolLamports,
        },
      };
    }

    return { ...catalogDetail, maps, ...(streamUrl !== null ? { streamUrl } : {}) };
  },

  async synchronizeSeries(input: Cs2CatalogSeriesInput): Promise<{ seriesId: Uuid; participantCount: number }> {
    validateInput(input);
    const assignments = input.participants.flatMap((slot) => slot.state === "known" ? [{ ...slot.team, displayOrder: slot.displayOrder }] : []);

    return db.transaction(async (tx) => {
      const now = new Date();
      const [competition] = await tx
        .insert(cs2Competitions)
        .values({
          gridTournamentId: input.competition.gridTournamentId,
          name: input.competition.name,
          shortName: input.competition.shortName ?? null,
          logoUrl: input.competition.logoUrl ?? null,
        })
        .onConflictDoUpdate({
          target: cs2Competitions.gridTournamentId,
          set: {
            name: input.competition.name,
            shortName: input.competition.shortName ?? null,
            logoUrl: input.competition.logoUrl ?? null,
            updatedAt: now,
          },
        })
        .returning({ id: cs2Competitions.id });
      if (competition === undefined) throw new Error(`Failed to persist competition ${input.competition.gridTournamentId}`);

      const [persistedSeries] = await tx
        .insert(series)
        .values({
          gridSeriesId: input.gridSeriesId,
          competitionId: competition.id,
          format: input.format,
          scheduledStartTime: input.scheduledStartTime,
          status: "active",
          catalogLifecycle: input.lifecycle,
          isSupported: input.isSupported,
        })
        .onConflictDoUpdate({
          target: series.gridSeriesId,
          set: {
            competitionId: competition.id,
            format: input.format,
            scheduledStartTime: input.scheduledStartTime,
            catalogLifecycle: sql`case
              when ${series.catalogLifecycle} in ('live', 'completed') then ${series.catalogLifecycle}
              else ${input.lifecycle}::cs2_series_lifecycle
            end`,
            isSupported: input.isSupported,
            updatedAt: now,
          },
        })
        .returning({ id: series.id });
      if (persistedSeries === undefined) throw new Error(`Failed to persist GRID series ${input.gridSeriesId}`);

      const participants = await reconcileSeriesParticipants(tx, persistedSeries.id, assignments);
      return { seriesId: persistedSeries.id, participantCount: participants.length };
    });
  },
};
