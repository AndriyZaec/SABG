import { and, asc, eq } from "drizzle-orm";
import type { Match, MatchPeriod, Score, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { matches } from "../schema.js";
import { matchRowToEntity } from "../mappers.js";

export const matchRepository = {
  async list(): Promise<Match[]> {
    const rows = await db.select().from(matches);
    return rows.map(matchRowToEntity);
  },

  async findById(id: Uuid): Promise<Match | undefined> {
    const [row] = await db.select().from(matches).where(eq(matches.id, id));
    return row ? matchRowToEntity(row) : undefined;
  },

  async findByTxoddsFixtureId(fixtureId: number): Promise<Match | undefined> {
    const [row] = await db.select().from(matches).where(eq(matches.txoddsFixtureId, fixtureId));
    return row ? matchRowToEntity(row) : undefined;
  },

  async listBySeriesId(seriesId: Uuid): Promise<Match[]> {
    const rows = await db
      .select()
      .from(matches)
      .where(eq(matches.seriesId, seriesId))
      .orderBy(asc(matches.seriesMatchIndex));
    return rows.map(matchRowToEntity);
  },

  async findBySeriesMatchIndex(seriesId: Uuid, matchIndex: number): Promise<Match | undefined> {
    const [row] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.seriesId, seriesId), eq(matches.seriesMatchIndex, matchIndex)));
    return row ? matchRowToEntity(row) : undefined;
  },

  // Preserve rows written by binaries that predate persisted map indexes.
  async ensureSeriesMatchIndexes(seriesId: Uuid): Promise<void> {
    const rows = await db
      .select({ id: matches.id, seriesMatchIndex: matches.seriesMatchIndex })
      .from(matches)
      .where(eq(matches.seriesId, seriesId))
      .orderBy(asc(matches.createdAt), asc(matches.id));
    let nextIndex = rows.reduce((max, row) => Math.max(max, row.seriesMatchIndex ?? 0), 0) + 1;
    for (const row of rows) {
      if (row.seriesMatchIndex !== null) continue;
      await db.update(matches).set({ seriesMatchIndex: nextIndex }).where(eq(matches.id, row.id));
      nextIndex += 1;
    }
  },

  async upsertByTxoddsFixtureId(
    fixtureId: number,
    placeholder: { homeTeam: string; awayTeam: string; startTime: Date },
  ): Promise<Match> {
    const existing = await this.findByTxoddsFixtureId(fixtureId);
    if (existing) return existing;

    const [row] = await db
      .insert(matches)
      .values({
        txoddsFixtureId: fixtureId,
        homeTeam: placeholder.homeTeam,
        awayTeam: placeholder.awayTeam,
        startTime: placeholder.startTime,
        status: "live",
        period: "pre",
        currentMinute: 0,
        scoreHome: 0,
        scoreAway: 0,
      })
      .onConflictDoUpdate({
        target: [matches.homeTeam, matches.awayTeam, matches.startTime],
        set: { txoddsFixtureId: fixtureId },
      })
      .returning();
    if (!row) throw new Error(`upsertByTxoddsFixtureId(${fixtureId}) returned no row`);
    return matchRowToEntity(row);
  },

  async upsertForSeriesMap(
    seriesId: Uuid,
    matchIndex: number,
    input: { homeTeam: string; awayTeam: string; startTime: Date },
  ): Promise<Match> {
    const [row] = await db
      .insert(matches)
      .values({
        discipline: "cs2",
        seriesId,
        seriesMatchIndex: matchIndex,
        homeTeam: input.homeTeam,
        awayTeam: input.awayTeam,
        startTime: input.startTime,
        status: "scheduled",
        period: "pre",
        currentMinute: 0,
        scoreHome: 0,
        scoreAway: 0,
      })
      .onConflictDoNothing({ target: [matches.seriesId, matches.seriesMatchIndex] })
      .returning();
    if (row) return matchRowToEntity(row);

    const existing = await this.findBySeriesMatchIndex(seriesId, matchIndex);
    if (!existing) throw new Error(`upsertForSeriesMap(${seriesId}, ${matchIndex}) found no row after conflict`);
    return existing;
  },

  async updateLive(
    id: Uuid,
    live: { currentMinute: number; period: MatchPeriod; score: Score; status?: Match["status"] },
  ): Promise<void> {
    await db
      .update(matches)
      .set({
        currentMinute: live.currentMinute,
        period: live.period,
        scoreHome: live.score.home,
        scoreAway: live.score.away,
        ...(live.status !== undefined ? { status: live.status } : {}),
      })
      .where(eq(matches.id, id));
  },
};
