import { and, asc, eq, inArray } from "drizzle-orm";
import type { Cs2Match, Cs2TeamIdentity, Match, MatchPeriod, Score, SoccerMatch, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { cs2MatchTeamScores, cs2SeriesParticipants, cs2Teams, matches } from "../schema.js";
import { matchRowToEntity } from "../mappers.js";
import { lockSeriesParticipantsForMatch } from "./cs2-participant-lifecycle.repository.js";

type MatchRow = typeof matches.$inferSelect;

async function hydrateMatches(rows: MatchRow[]): Promise<Match[]> {
  const cs2MatchIds = rows.filter((row) => row.discipline === "cs2").map((row) => row.id);
  const scoreRows = cs2MatchIds.length === 0
    ? []
    : await db
        .select({
          matchId: cs2MatchTeamScores.matchId,
          teamId: cs2Teams.id,
          name: cs2Teams.name,
          score: cs2MatchTeamScores.score,
          displayOrder: cs2SeriesParticipants.displayOrder,
        })
        .from(cs2MatchTeamScores)
        .innerJoin(matches, eq(cs2MatchTeamScores.matchId, matches.id))
        .innerJoin(cs2Teams, eq(cs2MatchTeamScores.teamId, cs2Teams.id))
        .innerJoin(
          cs2SeriesParticipants,
          and(
            eq(cs2SeriesParticipants.seriesId, matches.seriesId),
            eq(cs2SeriesParticipants.teamId, cs2MatchTeamScores.teamId),
          ),
        )
        .where(inArray(cs2MatchTeamScores.matchId, cs2MatchIds))
        .orderBy(asc(cs2MatchTeamScores.matchId), asc(cs2SeriesParticipants.displayOrder));

  const scoresByMatchId = new Map<string, typeof scoreRows>();
  for (const scoreRow of scoreRows) {
    const current = scoresByMatchId.get(scoreRow.matchId) ?? [];
    current.push(scoreRow);
    scoresByMatchId.set(scoreRow.matchId, current);
  }
  return rows.map((row) => matchRowToEntity(row, scoresByMatchId.get(row.id)));
}

async function hydrateMatch(row: MatchRow | undefined): Promise<Match | undefined> {
  if (row === undefined) return undefined;
  return (await hydrateMatches([row]))[0];
}

export const matchRepository = {
  async list(): Promise<Match[]> {
    const rows = await db.select().from(matches);
    return hydrateMatches(rows);
  },

  async findById(id: Uuid): Promise<Match | undefined> {
    const [row] = await db.select().from(matches).where(eq(matches.id, id));
    return hydrateMatch(row);
  },

  async findByTxoddsFixtureId(fixtureId: number): Promise<Match | undefined> {
    const [row] = await db.select().from(matches).where(eq(matches.txoddsFixtureId, fixtureId));
    return hydrateMatch(row);
  },

  async listBySeriesId(seriesId: Uuid): Promise<Match[]> {
    const rows = await db
      .select()
      .from(matches)
      .where(eq(matches.seriesId, seriesId))
      .orderBy(asc(matches.seriesMatchIndex));
    return hydrateMatches(rows);
  },

  async findBySeriesMatchIndex(seriesId: Uuid, matchIndex: number): Promise<Match | undefined> {
    const [row] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.seriesId, seriesId), eq(matches.seriesMatchIndex, matchIndex)));
    return hydrateMatch(row);
  },

  async upsertByTxoddsFixtureId(
    fixtureId: number,
    placeholder: { homeTeam: string; awayTeam: string; startTime: Date },
  ): Promise<SoccerMatch> {
    const existing = await this.findByTxoddsFixtureId(fixtureId);
    if (existing) {
      if (existing.discipline !== "soccer") throw new Error(`Fixture ${fixtureId} belongs to a non-soccer match`);
      return existing;
    }

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
    const match = matchRowToEntity(row);
    if (match.discipline !== "soccer") throw new Error(`Fixture ${fixtureId} created a non-soccer match`);
    return match;
  },

  async upsertForSeriesMap(
    seriesId: Uuid,
    matchIndex: number,
    input: { teams: readonly [Cs2TeamIdentity, Cs2TeamIdentity]; startTime: Date },
  ): Promise<Cs2Match> {
    if (input.teams[0].teamId === input.teams[1].teamId) {
      throw new Error(`CS2 series ${seriesId} contains duplicate team identity ${input.teams[0].teamId}`);
    }

    const matchId = await db.transaction(async (tx) => {
      await lockSeriesParticipantsForMatch(tx, seriesId, [input.teams[0].teamId, input.teams[1].teamId]);

      const [inserted] = await tx
        .insert(matches)
        .values({
          discipline: "cs2",
          seriesId,
          seriesMatchIndex: matchIndex,
          homeTeam: null,
          awayTeam: null,
          startTime: input.startTime,
          status: "scheduled",
          period: "pre",
          currentMinute: 0,
          scoreHome: null,
          scoreAway: null,
        })
        .onConflictDoNothing({ target: [matches.seriesId, matches.seriesMatchIndex] })
        .returning({ id: matches.id });
      const existing = inserted ?? (await tx
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.seriesId, seriesId), eq(matches.seriesMatchIndex, matchIndex))))[0];
      if (existing === undefined) {
        throw new Error(`upsertForSeriesMap(${seriesId}, ${matchIndex}) found no row after conflict`);
      }

      const persistedScores = await tx
        .select({ teamId: cs2MatchTeamScores.teamId })
        .from(cs2MatchTeamScores)
        .where(eq(cs2MatchTeamScores.matchId, existing.id));
      const persistedScoreIds = new Set(persistedScores.map((team) => team.teamId));
      if (persistedScores.length === 0) {
        await tx.insert(cs2MatchTeamScores).values(
          input.teams.map((team) => ({ matchId: existing.id, teamId: team.teamId, score: 0 })),
        );
      } else if (persistedScores.length !== 2 || input.teams.some((team) => !persistedScoreIds.has(team.teamId))) {
        throw new Error(`CS2 match ${existing.id} team identities changed`);
      }
      return existing.id;
    });

    const match = await this.findById(matchId);
    if (match === undefined) throw new Error(`CS2 match ${matchId} disappeared after upsert`);
    if (match.discipline !== "cs2") throw new Error(`Match ${matchId} is not a CS2 match`);
    return match;
  },

  async updateCs2TeamScores(
    id: Uuid,
    teamScores: readonly [{ teamId: Uuid; score: number }, { teamId: Uuid; score: number }],
  ): Promise<void> {
    if (
      teamScores[0].teamId === teamScores[1].teamId ||
      teamScores.some((team) => !Number.isInteger(team.score) || team.score < 0)
    ) {
      throw new Error(`CS2 match ${id} received invalid team scores`);
    }

    await db.transaction(async (tx) => {
      const [match] = await tx
        .select({ discipline: matches.discipline })
        .from(matches)
        .where(eq(matches.id, id))
        .for("update");
      if (match?.discipline !== "cs2") throw new Error(`Match ${id} is not a CS2 match`);

      const persisted = await tx
        .select({ teamId: cs2MatchTeamScores.teamId })
        .from(cs2MatchTeamScores)
        .where(eq(cs2MatchTeamScores.matchId, id));
      const persistedIds = new Set(persisted.map((team) => team.teamId));
      if (persisted.length !== 2 || teamScores.some((team) => !persistedIds.has(team.teamId))) {
        throw new Error(`CS2 match ${id} team identities changed`);
      }

      for (const team of teamScores) {
        await tx
          .update(cs2MatchTeamScores)
          .set({ score: team.score })
          .where(and(eq(cs2MatchTeamScores.matchId, id), eq(cs2MatchTeamScores.teamId, team.teamId)));
      }
    });
  },

  async setStatus(id: Uuid, status: Match["status"]): Promise<void> {
    await db.update(matches).set({ status }).where(eq(matches.id, id));
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
