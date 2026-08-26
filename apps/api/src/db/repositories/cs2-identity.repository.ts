import { asc, eq } from "drizzle-orm";
import type { Cs2TeamIdentity, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { cs2SeriesParticipants, cs2Teams, series } from "../schema.js";

export interface GridCs2TeamInput {
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  score: number;
}

export interface Cs2SeriesTeamIdentity extends Cs2TeamIdentity {
  gridTeamId: string;
  displayOrder: 1 | 2;
  seriesScore: number;
}

function validateInput(teams: readonly [GridCs2TeamInput, GridCs2TeamInput]): void {
  if (
    teams.some(
      (team) =>
        team.gridTeamId.trim() === "" ||
        team.name.trim() === "" ||
        !Number.isInteger(team.score) ||
        team.score < 0,
    )
  ) {
    throw new Error("CS2 series teams contain invalid identity or score data");
  }
  if (teams[0].gridTeamId === teams[1].gridTeamId) {
    throw new Error(`CS2 series teams contain duplicate GRID ID ${teams[0].gridTeamId}`);
  }
}

export const cs2IdentityRepository = {
  async synchronizeSeriesTeams(
    seriesId: Uuid,
    input: readonly [GridCs2TeamInput, GridCs2TeamInput],
  ): Promise<readonly [Cs2SeriesTeamIdentity, Cs2SeriesTeamIdentity]> {
    validateInput(input);

    return db.transaction(async (tx) => {
      const [lockedSeries] = await tx
        .select({ id: series.id })
        .from(series)
        .where(eq(series.id, seriesId))
        .for("update");
      if (lockedSeries === undefined) throw new Error(`CS2 series ${seriesId} does not exist`);

      const now = new Date();
      const persistedTeams: (typeof cs2Teams.$inferSelect)[] = [];
      for (const team of input) {
        const [row] = await tx
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
          .returning();
        if (row === undefined) throw new Error(`Failed to persist GRID team ${team.gridTeamId}`);
        persistedTeams.push(row);
      }

      const existing = await tx
        .select({ gridTeamId: cs2Teams.gridTeamId })
        .from(cs2SeriesParticipants)
        .innerJoin(cs2Teams, eq(cs2SeriesParticipants.teamId, cs2Teams.id))
        .where(eq(cs2SeriesParticipants.seriesId, seriesId));

      if (existing.length !== 0 && existing.length !== 2) {
        throw new Error(`CS2 series ${seriesId} has ${existing.length} persisted participants`);
      }

      if (existing.length === 2) {
        const existingIds = new Set(existing.map((team) => team.gridTeamId));
        if (input.some((team) => !existingIds.has(team.gridTeamId))) {
          throw new Error(`CS2 series ${seriesId} team identities changed`);
        }
      }

      for (const [index, team] of persistedTeams.entries()) {
        await tx
          .insert(cs2SeriesParticipants)
          .values({
            seriesId,
            teamId: team.id,
            displayOrder: (index + 1) as 1 | 2,
            score: input[index]!.score,
          })
          .onConflictDoUpdate({
            target: [cs2SeriesParticipants.seriesId, cs2SeriesParticipants.teamId],
            set: { score: input[index]!.score },
          });
      }

      const participants = await tx
        .select({
          teamId: cs2Teams.id,
          gridTeamId: cs2Teams.gridTeamId,
          name: cs2Teams.name,
          displayOrder: cs2SeriesParticipants.displayOrder,
          seriesScore: cs2SeriesParticipants.score,
        })
        .from(cs2SeriesParticipants)
        .innerJoin(cs2Teams, eq(cs2SeriesParticipants.teamId, cs2Teams.id))
        .where(eq(cs2SeriesParticipants.seriesId, seriesId))
        .orderBy(asc(cs2SeriesParticipants.displayOrder));

      if (participants.length !== 2 || participants[0]?.displayOrder !== 1 || participants[1]?.displayOrder !== 2) {
        throw new Error(`CS2 series ${seriesId} does not have a complete participant pair`);
      }

      return participants as [Cs2SeriesTeamIdentity, Cs2SeriesTeamIdentity];
    });
  },
};
