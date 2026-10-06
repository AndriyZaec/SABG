import type { SeriesStatus } from "@arena/contracts";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../client.js";
import { arenas, entryPasses, matches, series } from "../schema.js";

export interface OperatorSeriesState {
  id: string;
  status: SeriesStatus;
  priority: boolean;
  skipRequested: boolean;
  streamUrl: string | null;
}

export const operatorControlRepository = {
  async readRuntimeState(): Promise<{
    runningSeriesIds: string[];
    unfinishedArenaCount: number;
  }> {
    const runningRows = await db
      .selectDistinct({ gridSeriesId: series.gridSeriesId })
      .from(series)
      .innerJoin(matches, eq(matches.seriesId, series.id))
      .innerJoin(arenas, eq(arenas.matchId, matches.id))
      .where(eq(series.status, "active"));
    const [unfinished] = await db
      .select({ value: count() })
      .from(arenas)
      .innerJoin(matches, eq(arenas.matchId, matches.id))
      .where(and(
        eq(matches.discipline, "cs2"),
        sql`${arenas.status} not in ('finished', 'cancelled')`,
      ));
    return {
      runningSeriesIds: runningRows.map((row) => row.gridSeriesId),
      unfinishedArenaCount: unfinished?.value ?? 0,
    };
  },

  async findSeries(gridSeriesId: string): Promise<OperatorSeriesState | undefined> {
    const [row] = await db.select({
      id: series.id,
      status: series.status,
      priority: series.priority,
      skipRequested: series.skipRequested,
      streamUrl: series.streamUrl,
    }).from(series).where(eq(series.gridSeriesId, gridSeriesId));
    return row;
  },

  async setSeriesPriority(gridSeriesId: string, priority: boolean): Promise<boolean> {
    const rows = await db.update(series)
      .set({ priority, updatedAt: new Date() })
      .where(and(eq(series.gridSeriesId, gridSeriesId), eq(series.status, "active")))
      .returning({ id: series.id });
    return rows.length === 1;
  },

  async setSeriesStream(gridSeriesId: string, streamUrl: string | null): Promise<boolean> {
    const rows = await db.update(series)
      .set({ streamUrl, updatedAt: new Date() })
      .where(and(eq(series.gridSeriesId, gridSeriesId), eq(series.status, "active")))
      .returning({ id: series.id });
    return rows.length === 1;
  },

  async requestSeriesSkip(gridSeriesId: string): Promise<boolean> {
    const rows = await db.update(series)
      .set({ skipRequested: true, updatedAt: new Date() })
      .where(and(
        eq(series.gridSeriesId, gridSeriesId),
        eq(series.status, "active"),
        sql`not exists (
          select 1 from ${matches}
          inner join ${arenas} on ${arenas.matchId} = ${matches.id}
          inner join ${entryPasses} on ${entryPasses.arenaId} = ${arenas.id}
          where ${matches.seriesId} = ${series.id} and ${entryPasses.status} = 'paid'
        )`,
      ))
      .returning({ id: series.id });
    return rows.length === 1;
  },

  async hasPaidEntry(gridSeriesId: string): Promise<boolean> {
    const [row] = await db.select({ value: sql<boolean>`true` })
      .from(entryPasses)
      .innerJoin(arenas, eq(entryPasses.arenaId, arenas.id))
      .innerJoin(matches, eq(arenas.matchId, matches.id))
      .innerJoin(series, eq(matches.seriesId, series.id))
      .where(and(eq(series.gridSeriesId, gridSeriesId), eq(entryPasses.status, "paid")))
      .limit(1);
    return row !== undefined;
  },

};
