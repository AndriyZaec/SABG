import { eq, sql } from "drizzle-orm";
import type { Cs2SeriesLifecycle, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { cs2Competitions, cs2SeriesParticipants, cs2Teams, series } from "../schema.js";

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

export interface Cs2CatalogSeriesInput {
  gridSeriesId: string;
  competition: Cs2CatalogCompetitionInput;
  format: number;
  scheduledStartTime: Date;
  lifecycle: Cs2SeriesLifecycle;
  isSupported: boolean;
  teams: readonly Cs2CatalogTeamInput[];
}

function validateInput(input: Cs2CatalogSeriesInput): void {
  const text = [input.gridSeriesId, input.competition.gridTournamentId, input.competition.name];
  if (
    text.some((value) => value.trim() === "") ||
    !Number.isInteger(input.format) ||
    input.format < 1 ||
    input.format > 7 ||
    Number.isNaN(input.scheduledStartTime.getTime()) ||
    input.teams.length > 2 ||
    input.teams.some((team) => team.gridTeamId.trim() === "" || team.name.trim() === "") ||
    new Set(input.teams.map((team) => team.gridTeamId)).size !== input.teams.length
  ) {
    throw new Error(`CS2 catalog series ${input.gridSeriesId || "<unknown>"} is invalid`);
  }
}

export const cs2CatalogRepository = {
  async synchronizeSeries(input: Cs2CatalogSeriesInput): Promise<{ seriesId: Uuid; participantCount: number }> {
    validateInput(input);

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

      const existing = await tx
        .select({
          gridTeamId: cs2Teams.gridTeamId,
          displayOrder: cs2SeriesParticipants.displayOrder,
        })
        .from(cs2SeriesParticipants)
        .innerJoin(cs2Teams, eq(cs2SeriesParticipants.teamId, cs2Teams.id))
        .where(eq(cs2SeriesParticipants.seriesId, persistedSeries.id));
      if (existing.length > 2) throw new Error(`CS2 series ${persistedSeries.id} has too many participants`);

      const allGridTeamIds = new Set([...existing.map((team) => team.gridTeamId), ...input.teams.map((team) => team.gridTeamId)]);
      if (allGridTeamIds.size > 2) throw new Error(`CS2 series ${persistedSeries.id} team identities changed`);

      const existingByGridTeamId = new Map(existing.map((team) => [team.gridTeamId, team.displayOrder]));
      const usedOrders = new Set(existing.map((team) => team.displayOrder));
      for (const [index, team] of input.teams.entries()) {
        const [persistedTeam] = await tx
          .insert(cs2Teams)
          .values({
            gridTeamId: team.gridTeamId,
            name: team.name,
            shortName: team.shortName ?? null,
            logoUrl: team.logoUrl ?? null,
          })
          .onConflictDoUpdate({
            target: cs2Teams.gridTeamId,
            set: {
              name: team.name,
              shortName: team.shortName ?? null,
              logoUrl: team.logoUrl ?? null,
              updatedAt: now,
            },
          })
          .returning({ id: cs2Teams.id });
        if (persistedTeam === undefined) throw new Error(`Failed to persist GRID team ${team.gridTeamId}`);

        if (existingByGridTeamId.has(team.gridTeamId)) continue;
        const preferredOrder = index + 1;
        const displayOrder = (!usedOrders.has(preferredOrder) ? preferredOrder : [1, 2].find((order) => !usedOrders.has(order))) as
          | 1
          | 2
          | undefined;
        if (displayOrder === undefined) throw new Error(`CS2 series ${persistedSeries.id} has no free participant slot`);
        await tx.insert(cs2SeriesParticipants).values({
          seriesId: persistedSeries.id,
          teamId: persistedTeam.id,
          displayOrder,
          score: 0,
        });
        usedOrders.add(displayOrder);
      }

      return { seriesId: persistedSeries.id, participantCount: allGridTeamIds.size };
    });
  },
};
