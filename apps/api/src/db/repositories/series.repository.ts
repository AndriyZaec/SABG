// Series persistence (cs2-migration-spec/spec_v2.md §2). Backs cs2/series-orchestrator.ts —
// the first and, for now, only writer.

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

  /** Idempotent bootstrap, mirrors arena.repository.ts's upsertForMatch: find-then-insert, keyed
   *  by GRID's own series id (unique in schema.ts). */
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
