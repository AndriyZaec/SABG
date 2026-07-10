// B7 DAL — match persistence. `updateLive` is how B2's MatchState snapshots land in Postgres
// (arena-runtime.ts's matchState onSnapshot callback); `upsertByTxoddsFixtureId` backs the
// gateway's self-contained demo bootstrap (gateway/run.ts) — independent of db:seed, which seeds a
// different fixture than the replay uses.

import { eq } from "drizzle-orm";
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

  /**
   * Idempotent demo bootstrap (gateway/run.ts): ensures a placeholder match row exists for a
   * replay fixture, keyed by `txoddsFixtureId` — the TXODDS feed carries only home/away sides,
   * not team names, so this seeds a placeholder label rather than real teams.
   */
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

  /** Mirrors B2 MatchState snapshots (spec §13 Match.currentMinute/period/score). */
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
