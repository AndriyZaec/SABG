import { and, eq, sql } from "drizzle-orm";
import type { Cs2SeriesLifecycle, Series, SeriesStatus, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { series } from "../schema.js";
import { seriesRowToEntity } from "../mappers.js";

export const seriesRepository = {
  async findById(id: Uuid): Promise<Series | undefined> {
    const [row] = await db.select().from(series).where(eq(series.id, id));
    return row ? seriesRowToEntity(row) : undefined;
  },

  async findByGridSeriesId(gridSeriesId: string): Promise<Series | undefined> {
    const [row] = await db.select().from(series).where(eq(series.gridSeriesId, gridSeriesId));
    return row ? seriesRowToEntity(row) : undefined;
  },

  async upsertByGridSeriesId(
    gridSeriesId: string,
    defaults: { format: number; scheduledStartTime: Date },
  ): Promise<Series> {
    const existing = await this.findByGridSeriesId(gridSeriesId);
    if (existing) return existing;

    const [row] = await db
      .insert(series)
      .values({
        gridSeriesId,
        format: defaults.format,
        scheduledStartTime: defaults.scheduledStartTime,
        status: "active",
      })
      .returning();
    if (!row) throw new Error(`upsertByGridSeriesId(${gridSeriesId}) returned no row`);
    return seriesRowToEntity(row);
  },

  async setStatus(id: Uuid, status: SeriesStatus): Promise<void> {
    // A series leaving "active" is terminal (decided/invalid); the catalog's "live" join
    // window closes with it, regardless of which terminal status it lands on.
    await db
      .update(series)
      .set({ status, ...(status !== "active" ? { catalogLifecycle: "completed" } : {}) })
      .where(eq(series.id, id));
  },

  async setCatalogLifecycle(id: Uuid, catalogLifecycle: Cs2SeriesLifecycle): Promise<void> {
    await db.update(series).set({ catalogLifecycle }).where(eq(series.id, id));
  },

  async setMapNames(id: Uuid, mapNames: string[]): Promise<void> {
    const literal = sql.join(mapNames.map((name) => sql`${name}`), sql`, `);
    await db
      .update(series)
      .set({ mapNames })
      .where(and(eq(series.id, id), sql`${series.mapNames} IS DISTINCT FROM ARRAY[${literal}]::text[]`));
  },
};
