import { and, eq, inArray } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { cs2SeriesFollows } from "../schema.js";

export const cs2SeriesFollowRepository = {
  async follow(userId: Uuid, seriesId: Uuid): Promise<void> {
    await db.insert(cs2SeriesFollows).values({ userId, seriesId }).onConflictDoNothing();
  },

  async unfollow(userId: Uuid, seriesId: Uuid): Promise<void> {
    await db
      .delete(cs2SeriesFollows)
      .where(and(eq(cs2SeriesFollows.userId, userId), eq(cs2SeriesFollows.seriesId, seriesId)));
  },

  async listFollowerUserIds(seriesId: Uuid): Promise<Uuid[]> {
    const rows = await db
      .select({ userId: cs2SeriesFollows.userId })
      .from(cs2SeriesFollows)
      .where(eq(cs2SeriesFollows.seriesId, seriesId));
    return rows.map((row) => row.userId);
  },

  async listFollowedSeriesIds(userId: Uuid, seriesIds: Uuid[]): Promise<Uuid[]> {
    if (seriesIds.length === 0) return [];
    const rows = await db
      .select({ seriesId: cs2SeriesFollows.seriesId })
      .from(cs2SeriesFollows)
      .where(and(eq(cs2SeriesFollows.userId, userId), inArray(cs2SeriesFollows.seriesId, seriesIds)));
    return rows.map((row) => row.seriesId);
  },
};
