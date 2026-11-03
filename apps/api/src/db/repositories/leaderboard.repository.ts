import { and, asc, eq, sql } from "drizzle-orm";
import type { LeaderboardScopeStatus, Uuid } from "@arena/contracts";
import { db, type DatabaseTransaction } from "../client.js";
import { arenaResults, cs2Competitions, leaderboardEntries, leaderboardScopeCompetitions, leaderboardScopes, series, users } from "../schema.js";

export interface LeaderboardScope {
  id: Uuid;
  name: string;
  status: LeaderboardScopeStatus;
  isCurrent: boolean;
  closedAt: Date | null;
  createdAt: Date;
}

export interface LeaderboardEntryRow {
  userId: Uuid;
  rank: number;
  points: number;
  arenasPlayed: number;
  wins: number;
  secondPlaces: number;
  roundsPlayed: number;
  totalScore: number;
  totalPayoutLamports: number;
  computedAt: Date;
}

export interface LeaderboardEntryView extends LeaderboardEntryRow {
  username: string;
  avatar: string | null;
}

export type SetCurrentScopeResult = "switched" | "closed" | "current_changed";

export interface AdminCompetitionRow {
  id: Uuid;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  scopeIds: Uuid[];
  arenasWithResults: number;
  unfinished: boolean;
}

// Postgres binds at most 65 535 parameters per statement; an entry row binds 11.
const ENTRY_INSERT_CHUNK = 1_000;

const scopeColumns = {
  id: leaderboardScopes.id,
  name: leaderboardScopes.name,
  status: leaderboardScopes.status,
  isCurrent: leaderboardScopes.isCurrent,
  closedAt: leaderboardScopes.closedAt,
  createdAt: leaderboardScopes.createdAt,
};

const entryColumns = {
  userId: leaderboardEntries.userId,
  rank: leaderboardEntries.rank,
  points: leaderboardEntries.points,
  arenasPlayed: leaderboardEntries.arenasPlayed,
  wins: leaderboardEntries.wins,
  secondPlaces: leaderboardEntries.secondPlaces,
  roundsPlayed: leaderboardEntries.roundsPlayed,
  totalScore: leaderboardEntries.totalScore,
  totalPayoutLamports: leaderboardEntries.totalPayoutLamports,
  computedAt: leaderboardEntries.computedAt,
  username: users.username,
  avatar: users.avatar,
};

export const leaderboardRepository = {
  async createScope(name: string): Promise<LeaderboardScope> {
    const [row] = await db.insert(leaderboardScopes).values({ name }).returning(scopeColumns);
    if (!row) throw new Error("createScope returned no row");
    return row;
  },

  /** A closed scope can still be renamed. */
  async renameScope(scopeId: Uuid, name: string): Promise<boolean> {
    const rows = await db
      .update(leaderboardScopes)
      .set({ name, updatedAt: new Date() })
      .where(eq(leaderboardScopes.id, scopeId))
      .returning({ id: leaderboardScopes.id });
    return rows.length > 0;
  },

  async findScope(scopeId: Uuid): Promise<LeaderboardScope | undefined> {
    const [row] = await db.select(scopeColumns).from(leaderboardScopes).where(eq(leaderboardScopes.id, scopeId));
    return row;
  },

  async findCurrent(): Promise<LeaderboardScope | undefined> {
    const [row] = await db.select(scopeColumns).from(leaderboardScopes).where(eq(leaderboardScopes.isCurrent, true));
    return row;
  },

  async listScopes(): Promise<LeaderboardScope[]> {
    return db.select(scopeColumns).from(leaderboardScopes).orderBy(asc(leaderboardScopes.createdAt));
  },

  /**
   * Closes the current scope (if another one) and makes this open scope current, only while the current
   * scope is still `expectedCurrentId` (null: none). With none expected there is no row to lock: two
   * concurrent switches are left to the unique index on the current scope.
   */
  async setCurrent(scopeId: Uuid, expectedCurrentId: Uuid | null): Promise<SetCurrentScopeResult> {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ status: leaderboardScopes.status })
        .from(leaderboardScopes)
        .where(eq(leaderboardScopes.id, scopeId))
        .for("update");
      if (target?.status !== "open") return "closed";
      const [current] = await tx
        .select({ id: leaderboardScopes.id })
        .from(leaderboardScopes)
        .where(eq(leaderboardScopes.isCurrent, true))
        .for("update");
      if ((current?.id ?? null) !== expectedCurrentId) return "current_changed";
      const now = new Date();
      // Only the expected scope closes; one made current meanwhile makes the next update hit the index.
      if (expectedCurrentId !== null && expectedCurrentId !== scopeId) {
        await tx
          .update(leaderboardScopes)
          .set({ status: "closed", isCurrent: false, closedAt: now, updatedAt: now })
          .where(eq(leaderboardScopes.id, expectedCurrentId));
      }
      await tx.update(leaderboardScopes).set({ isCurrent: true, updatedAt: now }).where(eq(leaderboardScopes.id, scopeId));
      return "switched";
    });
  },

  /** Closes this scope while it is the current one, leaving none current. False when it isn't current. */
  async closeCurrent(expectedId: Uuid): Promise<boolean> {
    const now = new Date();
    const rows = await db
      .update(leaderboardScopes)
      .set({ status: "closed", isCurrent: false, closedAt: now, updatedAt: now })
      .where(and(eq(leaderboardScopes.isCurrent, true), eq(leaderboardScopes.id, expectedId)))
      .returning({ id: leaderboardScopes.id });
    return rows.length > 0;
  },

  async competitionExists(competitionId: Uuid): Promise<boolean> {
    const [row] = await db.select({ id: cs2Competitions.id }).from(cs2Competitions).where(eq(cs2Competitions.id, competitionId));
    return row !== undefined;
  },

  /** Every synced competition with what the admin needs to pick it for a scope. */
  async listAdminCompetitions(): Promise<AdminCompetitionRow[]> {
    // Qualified by hand: drizzle renders a single-table select's columns unqualified, which a subquery would resolve to its own table.
    const competitionId = sql.raw(`"cs2_competition"."id"`);
    return db
      .select({
        id: cs2Competitions.id,
        name: cs2Competitions.name,
        shortName: cs2Competitions.shortName,
        logoUrl: cs2Competitions.logoUrl,
        scopeIds: sql<Uuid[]>`coalesce((select array_agg(${leaderboardScopeCompetitions.scopeId}) from ${leaderboardScopeCompetitions} where ${leaderboardScopeCompetitions.competitionId} = ${competitionId}), '{}')`,
        arenasWithResults: sql<number>`(select count(distinct ${arenaResults.arenaId}) from ${arenaResults} where ${arenaResults.competitionId} = ${competitionId})`.mapWith(Number),
        unfinished: sql<boolean>`exists (select 1 from ${series} where ${series.competitionId} = ${competitionId} and ${series.catalogLifecycle} in ('upcoming', 'live'))`,
      })
      .from(cs2Competitions)
      .orderBy(asc(cs2Competitions.name));
  },

  async listScopeCompetitions(scopeId: Uuid): Promise<{ name: string; shortName: string | null; logoUrl: string | null }[]> {
    return db
      .select({ name: cs2Competitions.name, shortName: cs2Competitions.shortName, logoUrl: cs2Competitions.logoUrl })
      .from(leaderboardScopeCompetitions)
      .innerJoin(cs2Competitions, eq(cs2Competitions.id, leaderboardScopeCompetitions.competitionId))
      .where(eq(leaderboardScopeCompetitions.scopeId, scopeId))
      .orderBy(asc(cs2Competitions.name));
  },

  async listCompetitionIds(scopeId: Uuid): Promise<Uuid[]> {
    const rows = await db
      .select({ competitionId: leaderboardScopeCompetitions.competitionId })
      .from(leaderboardScopeCompetitions)
      .where(eq(leaderboardScopeCompetitions.scopeId, scopeId));
    return rows.map((row) => row.competitionId);
  },

  /** False when the scope isn't open: a closed scope's competitions never change. */
  async addCompetition(scopeId: Uuid, competitionId: Uuid): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx.insert(leaderboardScopeCompetitions).values({ scopeId, competitionId }).onConflictDoNothing();
      return true;
    });
  },

  async removeCompetition(scopeId: Uuid, competitionId: Uuid): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx
        .delete(leaderboardScopeCompetitions)
        .where(and(eq(leaderboardScopeCompetitions.scopeId, scopeId), eq(leaderboardScopeCompetitions.competitionId, competitionId)));
      return true;
    });
  },

  /**
   * Locks the scope row, then computes and writes its entries while holding it. Recomputes of one scope
   * run one after another, and each reads only after the previous one committed, so an older result
   * never overwrites a newer one. False, computing and writing nothing, when the scope is missing or
   * closed: it keeps its final rows. `computedAt` defaults to the time the inputs were read, not the
   * time the call started waiting for the lock.
   */
  async replaceEntries(
    scopeId: Uuid,
    compute: () => Promise<readonly Omit<LeaderboardEntryRow, "computedAt">[]>,
    computedAt?: Date,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      const at = computedAt ?? new Date();
      const entries = await compute();
      await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.scopeId, scopeId));
      for (let start = 0; start < entries.length; start += ENTRY_INSERT_CHUNK) {
        const chunk = entries.slice(start, start + ENTRY_INSERT_CHUNK);
        await tx.insert(leaderboardEntries).values(chunk.map((entry) => ({ ...entry, scopeId, computedAt: at })));
      }
      return true;
    });
  },

  async topEntries(scopeId: Uuid, limit: number): Promise<LeaderboardEntryView[]> {
    return db
      .select(entryColumns)
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .where(eq(leaderboardEntries.scopeId, scopeId))
      .orderBy(asc(leaderboardEntries.rank), asc(leaderboardEntries.userId))
      .limit(limit);
  },

  async entryFor(scopeId: Uuid, userId: Uuid): Promise<LeaderboardEntryView | undefined> {
    const [row] = await db
      .select(entryColumns)
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .where(and(eq(leaderboardEntries.scopeId, scopeId), eq(leaderboardEntries.userId, userId)));
    return row;
  },
};

async function lockOpenScope(tx: DatabaseTransaction, scopeId: Uuid): Promise<boolean> {
  const [scope] = await tx
    .select({ status: leaderboardScopes.status })
    .from(leaderboardScopes)
    .where(eq(leaderboardScopes.id, scopeId))
    .for("update");
  return scope?.status === "open";
}
