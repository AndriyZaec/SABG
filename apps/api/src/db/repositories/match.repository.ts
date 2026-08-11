// Match persistence. `updateLive` is how MatchState snapshots land in Postgres
// (arena-runtime.ts's matchState onSnapshot callback); `upsertByTxoddsFixtureId` backs the
// gateway's self-contained event bootstrap (gateway/run.ts) — independent of db:seed, which seeds a
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
   * Idempotent event bootstrap (gateway/run.ts, live/run.ts): ensures a match row exists for a
   * fixture, keyed by `txoddsFixtureId`. The TXODDS feed itself carries only home/away sides, not
   * team names — callers resolve real names from `db/seeds/fixture-metadata.ts` and pass them in
   * here; `"Home"`/`"Away"` is only a fallback for a fixture that isn't seeded yet.
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

  /**
   * Creates a CS2 map Match row for Series `seriesId` (cs2/series-orchestrator.ts, on
   * `open_arena`). Deliberately NOT idempotent/upserting like `upsertByTxoddsFixtureId` — CS2 has
   * no natural unique key for "map k of this Series" yet (multiple maps can share team names and
   * a nominal start time); restart-safe idempotency is a step-5 concern, once a live driver
   * actually needs to resume after a crash rather than always starting a fresh orchestrator.
   * `currentMinute`/`period`/`score` are soccer-only fields (spec) and stay at their placeholder
   * defaults forever for a CS2 row — nothing ever calls `updateLive` for one.
   *
   * Residual risk (found via testing, accepted rather than fixed): `matches`' unique index is on
   * `(homeTeam, awayTeam, startTime)` with no `seriesId` component, so this insert can still
   * collide — not just across maps of *this* Series (avoided because `startTime` is the real
   * open-time, strictly increasing map to map), but in principle across two *different* Series
   * that happen to share both team names and the exact same millisecond open-time. A live poller
   * makes that astronomically unlikely (real wall-clock timestamps, ~10s cadence); it was only
   * ever hit by two independent tests literally reusing the same synthetic clock constant.
   */
  async createForSeriesMap(
    seriesId: Uuid,
    input: { homeTeam: string; awayTeam: string; startTime: Date },
  ): Promise<Match> {
    const [row] = await db
      .insert(matches)
      .values({
        discipline: "cs2",
        seriesId,
        homeTeam: input.homeTeam,
        awayTeam: input.awayTeam,
        startTime: input.startTime,
        status: "scheduled",
        period: "pre",
        currentMinute: 0,
        scoreHome: 0,
        scoreAway: 0,
      })
      .returning();
    if (!row) throw new Error(`createForSeriesMap(${seriesId}) returned no row`);
    return matchRowToEntity(row);
  },

  /** Mirrors MatchState snapshots (spec §13 Match.currentMinute/period/score). */
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
