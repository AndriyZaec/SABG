import { eq } from "drizzle-orm";
import type { Series, SeriesStatus, Uuid } from "@arena/contracts";
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
    await db.update(series).set({ status }).where(eq(series.id, id));
  },
};
