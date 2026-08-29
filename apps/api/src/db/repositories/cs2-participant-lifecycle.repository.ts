import { and, asc, eq } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import type { DatabaseTransaction } from "../client.js";
import { cs2SeriesParticipants, cs2Teams, matches, series } from "../schema.js";

export interface Cs2ParticipantAssignmentInput {
  displayOrder: 1 | 2;
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  score?: number;
}

export interface PersistedCs2Participant {
  teamId: Uuid;
  gridTeamId: string;
  name: string;
  displayOrder: 1 | 2;
  seriesScore: number;
}

function validateAssignments(input: readonly Cs2ParticipantAssignmentInput[]): void {
  if (
    input.length > 2 ||
    input.some((team) => (
      team.gridTeamId.trim() === "" ||
      team.name.trim() === "" ||
      (team.score !== undefined && (!Number.isInteger(team.score) || team.score < 0))
    )) ||
    new Set(input.map((team) => team.gridTeamId)).size !== input.length ||
    new Set(input.map((team) => team.displayOrder)).size !== input.length
  ) {
    throw new Error("CS2 participant assignments are invalid");
  }
}

async function lockSeries(tx: DatabaseTransaction, seriesId: Uuid): Promise<void> {
  const [lockedSeries] = await tx
    .select({ id: series.id })
    .from(series)
    .where(eq(series.id, seriesId))
    .for("update");
  if (lockedSeries === undefined) throw new Error(`CS2 series ${seriesId} does not exist`);
}

async function readParticipants(tx: DatabaseTransaction, seriesId: Uuid): Promise<PersistedCs2Participant[]> {
  return await tx
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
    .orderBy(asc(cs2SeriesParticipants.displayOrder)) as PersistedCs2Participant[];
}

export async function reconcileSeriesParticipants(
  tx: DatabaseTransaction,
  seriesId: Uuid,
  input: readonly Cs2ParticipantAssignmentInput[],
): Promise<PersistedCs2Participant[]> {
  validateAssignments(input);
  await lockSeries(tx, seriesId);

  const existing = await readParticipants(tx, seriesId);
  const [existingMatch] = await tx
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.seriesId, seriesId))
    .limit(1);
  const now = new Date();
  const persistedByGridId = new Map<string, typeof cs2Teams.$inferSelect>();
  for (const team of [...input].sort((left, right) => left.gridTeamId.localeCompare(right.gridTeamId))) {
    const [persisted] = await tx
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
    if (persisted === undefined) throw new Error(`Failed to persist GRID team ${team.gridTeamId}`);
    persistedByGridId.set(team.gridTeamId, persisted);
  }

  const existingIds = new Set(existing.map((team) => team.gridTeamId));
  if (existingMatch !== undefined) {
    if (input.some((team) => !existingIds.has(team.gridTeamId)) || (input.length === 2 && existing.length !== 2)) {
      throw new Error(`CS2 series ${seriesId} team identities changed after Match creation`);
    }
    for (const team of input) {
      if (team.score === undefined) continue;
      const persisted = persistedByGridId.get(team.gridTeamId)!;
      await tx
        .update(cs2SeriesParticipants)
        .set({ score: team.score })
        .where(and(
          eq(cs2SeriesParticipants.seriesId, seriesId),
          eq(cs2SeriesParticipants.teamId, persisted.id),
        ));
    }
    return readParticipants(tx, seriesId);
  }

  if (input.length === 2) {
    const existingByGridId = new Map(existing.map((team) => [team.gridTeamId, team]));
    const assignments: Array<{ teamId: Uuid; displayOrder: 1 | 2; score: number }> = [];
    const usedOrders = new Set<1 | 2>();
    for (const team of input) {
      const previous = existingByGridId.get(team.gridTeamId);
      if (previous === undefined) continue;
      assignments.push({
        teamId: previous.teamId,
        displayOrder: previous.displayOrder,
        score: team.score ?? previous.seriesScore,
      });
      usedOrders.add(previous.displayOrder);
    }
    for (const team of input) {
      if (existingByGridId.has(team.gridTeamId)) continue;
      const persisted = persistedByGridId.get(team.gridTeamId)!;
      const displayOrder = !usedOrders.has(team.displayOrder)
        ? team.displayOrder
        : ([1, 2] as const).find((order) => !usedOrders.has(order));
      if (displayOrder === undefined) throw new Error(`CS2 series ${seriesId} has no free participant slot`);
      assignments.push({ teamId: persisted.id, displayOrder, score: team.score ?? 0 });
      usedOrders.add(displayOrder);
    }
    await tx.delete(cs2SeriesParticipants).where(eq(cs2SeriesParticipants.seriesId, seriesId));
    await tx.insert(cs2SeriesParticipants).values(
      assignments.map((assignment) => ({ seriesId, ...assignment })),
    );
    return readParticipants(tx, seriesId);
  }

  const occupiedOrders = new Set(existing.map((team) => team.displayOrder));
  for (const team of input) {
    const previous = existing.find((item) => item.gridTeamId === team.gridTeamId);
    if (previous !== undefined) {
      if (team.score !== undefined) {
        await tx
          .update(cs2SeriesParticipants)
          .set({ score: team.score })
          .where(and(
            eq(cs2SeriesParticipants.seriesId, seriesId),
            eq(cs2SeriesParticipants.teamId, previous.teamId),
          ));
      }
      continue;
    }
    if (occupiedOrders.has(team.displayOrder)) continue;
    const persisted = persistedByGridId.get(team.gridTeamId)!;
    await tx.insert(cs2SeriesParticipants).values({
      seriesId,
      teamId: persisted.id,
      displayOrder: team.displayOrder,
      score: team.score ?? 0,
    });
  }
  return readParticipants(tx, seriesId);
}

export async function lockSeriesParticipantsForMatch(
  tx: DatabaseTransaction,
  seriesId: Uuid,
  expectedTeamIds: readonly [Uuid, Uuid],
): Promise<void> {
  await lockSeries(tx, seriesId);
  const participants = await readParticipants(tx, seriesId);
  const participantIds = new Set(participants.map((participant) => participant.teamId));
  if (participants.length !== 2 || expectedTeamIds.some((teamId) => !participantIds.has(teamId))) {
    throw new Error(`CS2 match teams do not match series ${seriesId} participants`);
  }
}
