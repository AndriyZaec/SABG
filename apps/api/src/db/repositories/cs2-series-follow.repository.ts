import { eq } from "drizzle-orm";
import type { Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { cs2SeriesFollows } from "../schema.js";

export const cs2SeriesFollowRepository = {
  async follow(userId: Uuid, seriesId: Uuid): Promise<void> {
    await db.insert(cs2SeriesFollows).values({ userId, seriesId }).onConflictDoNothing();
  },

  async listFollowerUserIds(seriesId: Uuid): Promise<Uuid[]> {
    const rows = await db
      .select({ userId: cs2SeriesFollows.userId })
      .from(cs2SeriesFollows)
      .where(eq(cs2SeriesFollows.seriesId, seriesId));
    return rows.map((row) => row.userId);
  },
};
