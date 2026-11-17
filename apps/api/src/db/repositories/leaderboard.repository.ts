import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { LeaderboardMarkAction, LeaderboardMarkStatus, LeaderboardScopeStatus, Uuid } from "@arena/contracts";
import { db, type DatabaseTransaction } from "../client.js";
import { assignPrizePlaces } from "../../leaderboard/player-ranking.js";
import {
  arenaResults,
  cs2Competitions,
  leaderboardEntries,
  leaderboardMarkDrafts,
  leaderboardMarks,
  leaderboardPrizeClaims,
  leaderboardPrizes,
  leaderboardScopeCompetitions,
  leaderboardScopes,
  series,
  users,
} from "../schema.js";

export interface LeaderboardScope {
  id: Uuid;
  name: string;
  status: LeaderboardScopeStatus;
  isCurrent: boolean;
  closedAt: Date | null;
  finalizedAt: Date | null;
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
  disqualified: boolean;
  computedAt: Date;
}

export interface LeaderboardEntryView extends LeaderboardEntryRow {
  username: string;
  avatar: string | null;
}

export interface LeaderboardPrize {
  place: number;
  imageUrl: string;
}

export interface ScopePrize extends LeaderboardPrize {
  scopeId: Uuid;
}

export interface LeaderboardMark {
  userId: Uuid;
  status: LeaderboardMarkStatus;
  reason: string | null;
  appliedAt: Date;
}

export interface LeaderboardMarkDraft {
  userId: Uuid;
  action: LeaderboardMarkAction;
  reason: string | null;
  actorLogin: string;
  updatedAt: Date;
}

/**
 * `current_has_prizes`: the current scope holds prizes, so only ending it (`endCurrent`) may close it.
 * `current_has_drafts`: closing it would drop its staged mark changes.
 */
export type SetCurrentScopeResult = "switched" | "closed" | "current_changed" | "current_has_prizes" | "current_has_drafts";

export interface PrizeClaimView {
  scopeId: Uuid;
  place: number;
  userId: Uuid;
  username: string;
  walletAddress: string;
  imageUrl: string;
  tradeUrl: string | null;
  tradeUrlUpdatedAt: Date | null;
  sentAt: Date | null;
  tradeUrlErasedAt: Date | null;
}

export interface PlayerPrizeClaim {
  place: number;
  imageUrl: string;
  tradeUrl: string | null;
  sentAt: Date | null;
}

export type SetTradeUrlResult = { kind: "saved"; claim: PlayerPrizeClaim } | { kind: "not_found" } | { kind: "sent" };

export type MarkPrizeSentResult =
  /** `previous` is the date of an earlier mark; a repeat keeps it. */
  | { kind: "sent"; sentAt: Date; previous: Date | null }
  | { kind: "not_found" }
  /** Marking sent locks the trade URL, so it waits until the winner gives one. */
  | { kind: "no_trade_url" };

export type EndScopeResult =
  /** A scope without prizes: closed, nothing awarded. */
  | { kind: "closed" }
  | { kind: "finalized"; claims: number }
  | { kind: "current_changed" }
  | { kind: "drafts_pending" }
  /** Players on prize places without an applied approval, by username. */
  | { kind: "unapproved"; usernames: string[] };

export interface AdminCompetitionRow {
  id: Uuid;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  scopeIds: Uuid[];
  arenasWithResults: number;
  unfinished: boolean;
}

export interface ScopeCompetitionSummary {
  scopeId: Uuid;
  competitionCount: number;
  unfinishedCompetitions: string[];
}

// The admin list without a search shows only the latest synced competitions.
const ADMIN_COMPETITIONS_LATEST = 10;

// Postgres binds at most 65 535 parameters per statement; an entry row binds 12.
const ENTRY_INSERT_CHUNK = 1_000;

const scopeColumns = {
  id: leaderboardScopes.id,
  name: leaderboardScopes.name,
  status: leaderboardScopes.status,
  isCurrent: leaderboardScopes.isCurrent,
  closedAt: leaderboardScopes.closedAt,
  finalizedAt: leaderboardScopes.finalizedAt,
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
  disqualified: leaderboardEntries.disqualified,
  computedAt: leaderboardEntries.computedAt,
  username: users.username,
  avatar: users.avatar,
};

/** Joins a prize claim to its scope's prize for the place, which a finalized scope keeps locked. */
const claimPrize = and(
  eq(leaderboardPrizes.scopeId, leaderboardPrizeClaims.scopeId),
  eq(leaderboardPrizes.place, leaderboardPrizeClaims.place),
);

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

  /** The scope players see: the current one, else the one closed last, as its final results. */
  async findShownScope(): Promise<LeaderboardScope | undefined> {
    const [row] = await db
      .select(scopeColumns)
      .from(leaderboardScopes)
      .where(or(eq(leaderboardScopes.isCurrent, true), eq(leaderboardScopes.status, "closed")))
      .orderBy(desc(leaderboardScopes.isCurrent), sql`${leaderboardScopes.closedAt} desc nulls last`)
      .limit(1);
    return row;
  },

  async listScopes(): Promise<LeaderboardScope[]> {
    return db.select(scopeColumns).from(leaderboardScopes).orderBy(asc(leaderboardScopes.createdAt));
  },

  /**
   * Closes the current scope (if another one) and makes this open scope current, only while the current
   * scope is still `expectedCurrentId` (null: none) and holds no prizes or staged mark changes. With none expected there is no
   * row to lock: two concurrent switches are left to the unique index on the current scope.
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
      // Prizes and drafts are set under this same row lock, so none can appear before the close below.
      if (expectedCurrentId !== null && expectedCurrentId !== scopeId) {
        if (await hasPrizes(tx, expectedCurrentId)) return "current_has_prizes";
        if (await hasMarkDrafts(tx, expectedCurrentId)) return "current_has_drafts";
      }
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

  async competitionExists(competitionId: Uuid): Promise<boolean> {
    const [row] = await db.select({ id: cs2Competitions.id }).from(cs2Competitions).where(eq(cs2Competitions.id, competitionId));
    return row !== undefined;
  },

  /**
   * Synced competitions with what the admin needs to pick one for a scope, latest synced first: the latest
   * few without a query, every competition whose name contains the query otherwise.
   */
  async listAdminCompetitions(query?: string): Promise<AdminCompetitionRow[]> {
    // Qualified by hand: drizzle renders a single-table select's columns unqualified, which a subquery would resolve to its own table.
    const competitionId = sql.raw(`"cs2_competition"."id"`);
    const rows = db
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
      .where(query === undefined ? undefined : ilike(cs2Competitions.name, `%${query.replace(/[\\%_]/g, "\\$&")}%`))
      .orderBy(desc(cs2Competitions.createdAt), desc(cs2Competitions.id))
      .$dynamic();
    return query === undefined ? rows.limit(ADMIN_COMPETITIONS_LATEST) : rows;
  },

  /** Per scope with competitions: how many it counts and which of them still have a series to come. */
  async listScopeCompetitionSummaries(): Promise<ScopeCompetitionSummary[]> {
    return db
      .select({
        scopeId: leaderboardScopeCompetitions.scopeId,
        competitionCount: sql<number>`count(*)`.mapWith(Number),
        unfinishedCompetitions: sql<string[]>`coalesce(array_agg(${cs2Competitions.name} order by ${cs2Competitions.name}) filter (where exists (select 1 from ${series} where ${series.competitionId} = ${cs2Competitions.id} and ${series.catalogLifecycle} in ('upcoming', 'live'))), '{}')`,
      })
      .from(leaderboardScopeCompetitions)
      .innerJoin(cs2Competitions, eq(cs2Competitions.id, leaderboardScopeCompetitions.competitionId))
      .groupBy(leaderboardScopeCompetitions.scopeId);
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

  async listPrizes(scopeId: Uuid): Promise<LeaderboardPrize[]> {
    return db
      .select({ place: leaderboardPrizes.place, imageUrl: leaderboardPrizes.imageUrl })
      .from(leaderboardPrizes)
      .where(eq(leaderboardPrizes.scopeId, scopeId))
      .orderBy(asc(leaderboardPrizes.place));
  },

  /** Every scope's prizes in one read, for the admin overview. */
  async listAllPrizes(): Promise<ScopePrize[]> {
    return db
      .select({ scopeId: leaderboardPrizes.scopeId, place: leaderboardPrizes.place, imageUrl: leaderboardPrizes.imageUrl })
      .from(leaderboardPrizes)
      .orderBy(asc(leaderboardPrizes.scopeId), asc(leaderboardPrizes.place));
  },

  /** Adds or replaces a place's prize. False when the scope isn't open: a closed scope's prizes never change. */
  async setPrize(scopeId: Uuid, place: number, imageUrl: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx
        .insert(leaderboardPrizes)
        .values({ scopeId, place, imageUrl })
        .onConflictDoUpdate({
          target: [leaderboardPrizes.scopeId, leaderboardPrizes.place],
          set: { imageUrl, updatedAt: sql`now()` },
        });
      return true;
    });
  },

  async removePrize(scopeId: Uuid, place: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx.delete(leaderboardPrizes).where(and(eq(leaderboardPrizes.scopeId, scopeId), eq(leaderboardPrizes.place, place)));
      return true;
    });
  },

  async userExists(userId: Uuid): Promise<boolean> {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    return row !== undefined;
  },

  async listMarks(scopeId: Uuid): Promise<LeaderboardMark[]> {
    return db
      .select({ userId: leaderboardMarks.userId, status: leaderboardMarks.status, reason: leaderboardMarks.reason, appliedAt: leaderboardMarks.appliedAt })
      .from(leaderboardMarks)
      .where(eq(leaderboardMarks.scopeId, scopeId))
      .orderBy(asc(leaderboardMarks.userId));
  },

  async findMark(scopeId: Uuid, userId: Uuid): Promise<Omit<LeaderboardMark, "userId"> | undefined> {
    const [row] = await db
      .select({ status: leaderboardMarks.status, reason: leaderboardMarks.reason, appliedAt: leaderboardMarks.appliedAt })
      .from(leaderboardMarks)
      .where(and(eq(leaderboardMarks.scopeId, scopeId), eq(leaderboardMarks.userId, userId)));
    return row;
  },

  async listMarkDrafts(scopeId: Uuid): Promise<LeaderboardMarkDraft[]> {
    return db
      .select({
        userId: leaderboardMarkDrafts.userId,
        action: leaderboardMarkDrafts.action,
        reason: leaderboardMarkDrafts.reason,
        actorLogin: leaderboardMarkDrafts.actorLogin,
        updatedAt: leaderboardMarkDrafts.updatedAt,
      })
      .from(leaderboardMarkDrafts)
      .where(eq(leaderboardMarkDrafts.scopeId, scopeId))
      .orderBy(asc(leaderboardMarkDrafts.userId));
  },

  /** Stages or replaces a player's mark change. False when the scope isn't open. */
  async setMarkDraft(scopeId: Uuid, userId: Uuid, action: LeaderboardMarkAction, reason: string | null, actorLogin: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx
        .insert(leaderboardMarkDrafts)
        .values({ scopeId, userId, action, reason, actorLogin })
        .onConflictDoUpdate({
          target: [leaderboardMarkDrafts.scopeId, leaderboardMarkDrafts.userId],
          set: { action, reason, actorLogin, updatedAt: sql`now()` },
        });
      return true;
    });
  },

  async removeMarkDraft(scopeId: Uuid, userId: Uuid): Promise<boolean> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      await tx.delete(leaderboardMarkDrafts).where(and(eq(leaderboardMarkDrafts.scopeId, scopeId), eq(leaderboardMarkDrafts.userId, userId)));
      return true;
    });
  },

  /**
   * Turns every staged change of the scope into applied marks (`clear` removes the mark) and drops the
   * drafts, under the scope row lock `replaceEntries` holds: a recompute reads all of them or none.
   * Returns how many changes were applied; false, changing nothing, when the scope isn't open.
   */
  async applyMarkDrafts(scopeId: Uuid): Promise<number | false> {
    return db.transaction(async (tx) => {
      if (!(await lockOpenScope(tx, scopeId))) return false;
      const drafts = await tx
        .delete(leaderboardMarkDrafts)
        .where(eq(leaderboardMarkDrafts.scopeId, scopeId))
        .returning({ userId: leaderboardMarkDrafts.userId, action: leaderboardMarkDrafts.action, reason: leaderboardMarkDrafts.reason });
      const cleared = drafts.filter((draft) => draft.action === "clear").map((draft) => draft.userId);
      if (cleared.length > 0) {
        await tx.delete(leaderboardMarks).where(and(eq(leaderboardMarks.scopeId, scopeId), inArray(leaderboardMarks.userId, cleared)));
      }
      const marks = drafts.flatMap((draft) => draft.action === "clear"
        ? []
        : [{ scopeId, userId: draft.userId, status: draft.action === "approve" ? "approved" as const : "disqualified" as const, reason: draft.reason }]);
      if (marks.length > 0) {
        const appliedAt = new Date();
        await tx
          .insert(leaderboardMarks)
          .values(marks.map((mark) => ({ ...mark, appliedAt })))
          .onConflictDoUpdate({
            target: [leaderboardMarks.scopeId, leaderboardMarks.userId],
            set: { status: sql`excluded.status`, reason: sql`excluded.reason`, appliedAt, updatedAt: sql`now()` },
          });
      }
      return drafts.length;
    });
  },

  /**
   * Ends the current scope in one step under the scope row lock, while it is still open and current and
   * no mark change is staged: computes and writes the final entries (as `replaceEntries` does), then
   * closes it. A scope with prizes is finalized on the way: the prize places go out by position over the
   * final entries, every player on one needs an applied approval, the claims are stored and
   * `finalized_at` is set. Marks and prizes change under the same lock, so neither can move between the
   * final ranking and the close.
   */
  async endCurrent(
    scopeId: Uuid,
    compute: () => Promise<readonly Omit<LeaderboardEntryRow, "computedAt">[]>,
    computedAt?: Date,
  ): Promise<EndScopeResult> {
    return db.transaction(async (tx) => {
      const [scope] = await tx
        .select({ status: leaderboardScopes.status, isCurrent: leaderboardScopes.isCurrent })
        .from(leaderboardScopes)
        .where(eq(leaderboardScopes.id, scopeId))
        .for("update");
      if (scope?.status !== "open" || !scope.isCurrent) return { kind: "current_changed" };
      if (await hasMarkDrafts(tx, scopeId)) return { kind: "drafts_pending" };
      const prizes = await tx.select({ place: leaderboardPrizes.place }).from(leaderboardPrizes).where(eq(leaderboardPrizes.scopeId, scopeId));

      await writeEntries(tx, scopeId, await compute(), computedAt ?? new Date());
      const now = new Date();
      if (prizes.length === 0) {
        await tx
          .update(leaderboardScopes)
          .set({ status: "closed", isCurrent: false, closedAt: now, updatedAt: now })
          .where(eq(leaderboardScopes.id, scopeId));
        return { kind: "closed" };
      }

      const entries = await tx
        .select({ userId: leaderboardEntries.userId, disqualified: leaderboardEntries.disqualified, username: users.username })
        .from(leaderboardEntries)
        .innerJoin(users, eq(users.id, leaderboardEntries.userId))
        .where(eq(leaderboardEntries.scopeId, scopeId))
        .orderBy(asc(leaderboardEntries.rank), desc(leaderboardEntries.disqualified), asc(leaderboardEntries.userId));
      const places = assignPrizePlaces(entries, prizes.map((prize) => prize.place));
      const approved = new Set((await tx
        .select({ userId: leaderboardMarks.userId })
        .from(leaderboardMarks)
        .where(and(eq(leaderboardMarks.scopeId, scopeId), eq(leaderboardMarks.status, "approved")))).map((mark) => mark.userId));
      const unapproved = entries.filter((entry) => places.has(entry.userId) && !approved.has(entry.userId)).map((entry) => entry.username);
      // A refusal still commits the fresh entries, so the admin preview shows the ranking it was checked against.
      if (unapproved.length > 0) return { kind: "unapproved", usernames: unapproved };

      if (places.size > 0) {
        await tx.insert(leaderboardPrizeClaims).values([...places].map(([userId, place]) => ({ scopeId, place, userId })));
      }
      await tx
        .update(leaderboardScopes)
        .set({ status: "closed", isCurrent: false, closedAt: now, finalizedAt: now, updatedAt: now })
        .where(eq(leaderboardScopes.id, scopeId));
      return { kind: "finalized", claims: places.size };
    });
  },

  /** The prize claims of these scopes with the winner and the prize image, by scope and place. */
  async listPrizeClaims(scopeIds: readonly Uuid[]): Promise<PrizeClaimView[]> {
    if (scopeIds.length === 0) return [];
    return db
      .select({
        scopeId: leaderboardPrizeClaims.scopeId,
        place: leaderboardPrizeClaims.place,
        userId: leaderboardPrizeClaims.userId,
        username: users.username,
        walletAddress: users.walletAddress,
        imageUrl: leaderboardPrizes.imageUrl,
        tradeUrl: leaderboardPrizeClaims.tradeUrl,
        tradeUrlUpdatedAt: leaderboardPrizeClaims.tradeUrlUpdatedAt,
        sentAt: leaderboardPrizeClaims.sentAt,
        tradeUrlErasedAt: leaderboardPrizeClaims.tradeUrlErasedAt,
      })
      .from(leaderboardPrizeClaims)
      .innerJoin(users, eq(users.id, leaderboardPrizeClaims.userId))
      .innerJoin(leaderboardPrizes, claimPrize)
      .where(inArray(leaderboardPrizeClaims.scopeId, [...scopeIds]))
      .orderBy(asc(leaderboardPrizeClaims.scopeId), asc(leaderboardPrizeClaims.place));
  },

  async findPrizeClaim(scopeId: Uuid, userId: Uuid): Promise<PlayerPrizeClaim | undefined> {
    const [row] = await db
      .select({
        place: leaderboardPrizeClaims.place,
        imageUrl: leaderboardPrizes.imageUrl,
        tradeUrl: leaderboardPrizeClaims.tradeUrl,
        sentAt: leaderboardPrizeClaims.sentAt,
      })
      .from(leaderboardPrizeClaims)
      .innerJoin(leaderboardPrizes, claimPrize)
      .where(and(eq(leaderboardPrizeClaims.scopeId, scopeId), eq(leaderboardPrizeClaims.userId, userId)));
    return row;
  },

  /** Stores the winner's trade URL; it can change until the prize is marked sent. */
  async setTradeUrl(scopeId: Uuid, userId: Uuid, tradeUrl: string): Promise<SetTradeUrlResult> {
    return db.transaction(async (tx) => {
      const claimKey = and(eq(leaderboardPrizeClaims.scopeId, scopeId), eq(leaderboardPrizeClaims.userId, userId));
      // Shares the row lock with `markPrizeSent`, so a URL change never lands after the sent mark.
      const [claim] = await tx
        .select({ place: leaderboardPrizeClaims.place, imageUrl: leaderboardPrizes.imageUrl, sentAt: leaderboardPrizeClaims.sentAt })
        .from(leaderboardPrizeClaims)
        .innerJoin(leaderboardPrizes, claimPrize)
        .where(claimKey)
        .for("update", { of: leaderboardPrizeClaims });
      if (claim === undefined) return { kind: "not_found" };
      if (claim.sentAt !== null) return { kind: "sent" };
      await tx
        .update(leaderboardPrizeClaims)
        .set({ tradeUrl, tradeUrlUpdatedAt: sql`now()`, updatedAt: sql`now()` })
        .where(claimKey);
      return { kind: "saved", claim: { place: claim.place, imageUrl: claim.imageUrl, tradeUrl, sentAt: null } };
    });
  },

  /** Erases the trade URLs of prizes sent before `before`; the claim keeps the player, the prize and the dates. */
  async eraseSentTradeUrls(before: Date): Promise<number> {
    const rows = await db
      .update(leaderboardPrizeClaims)
      .set({ tradeUrl: null, tradeUrlErasedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(lt(leaderboardPrizeClaims.sentAt, before), isNotNull(leaderboardPrizeClaims.tradeUrl)))
      .returning({ place: leaderboardPrizeClaims.place });
    return rows.length;
  },

  /** Marks a claim's prize sent, keeping the first date on a repeat. */
  async markPrizeSent(scopeId: Uuid, place: number): Promise<MarkPrizeSentResult> {
    return db.transaction(async (tx) => {
      const claimKey = and(eq(leaderboardPrizeClaims.scopeId, scopeId), eq(leaderboardPrizeClaims.place, place));
      const [claim] = await tx
        .select({ tradeUrl: leaderboardPrizeClaims.tradeUrl, sentAt: leaderboardPrizeClaims.sentAt })
        .from(leaderboardPrizeClaims)
        .where(claimKey)
        .for("update");
      if (claim === undefined) return { kind: "not_found" };
      if (claim.sentAt !== null) return { kind: "sent", sentAt: claim.sentAt, previous: claim.sentAt };
      if (claim.tradeUrl === null) return { kind: "no_trade_url" };
      const [row] = await tx
        .update(leaderboardPrizeClaims)
        .set({ sentAt: sql`now()`, updatedAt: sql`now()` })
        .where(claimKey)
        .returning({ sentAt: leaderboardPrizeClaims.sentAt });
      return { kind: "sent", sentAt: row!.sentAt!, previous: null };
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
      await writeEntries(tx, scopeId, await compute(), at);
      return true;
    });
  },

  async topEntries(scopeId: Uuid, limit: number): Promise<LeaderboardEntryView[]> {
    return db
      .select(entryColumns)
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .where(eq(leaderboardEntries.scopeId, scopeId))
      // The board order of `compareBoardOrder`: a disqualified row stands before the real one sharing its rank.
      .orderBy(asc(leaderboardEntries.rank), desc(leaderboardEntries.disqualified), asc(leaderboardEntries.userId))
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

async function writeEntries(
  tx: DatabaseTransaction,
  scopeId: Uuid,
  entries: readonly Omit<LeaderboardEntryRow, "computedAt">[],
  computedAt: Date,
): Promise<void> {
  await tx.delete(leaderboardEntries).where(eq(leaderboardEntries.scopeId, scopeId));
  for (let start = 0; start < entries.length; start += ENTRY_INSERT_CHUNK) {
    const chunk = entries.slice(start, start + ENTRY_INSERT_CHUNK);
    await tx.insert(leaderboardEntries).values(chunk.map((entry) => ({ ...entry, scopeId, computedAt })));
  }
}

async function hasPrizes(tx: DatabaseTransaction, scopeId: Uuid): Promise<boolean> {
  const [prize] = await tx.select({ place: leaderboardPrizes.place }).from(leaderboardPrizes).where(eq(leaderboardPrizes.scopeId, scopeId)).limit(1);
  return prize !== undefined;
}

async function hasMarkDrafts(tx: DatabaseTransaction, scopeId: Uuid): Promise<boolean> {
  const [draft] = await tx.select({ userId: leaderboardMarkDrafts.userId }).from(leaderboardMarkDrafts).where(eq(leaderboardMarkDrafts.scopeId, scopeId)).limit(1);
  return draft !== undefined;
}

async function lockOpenScope(tx: DatabaseTransaction, scopeId: Uuid): Promise<boolean> {
  const [scope] = await tx
    .select({ status: leaderboardScopes.status })
    .from(leaderboardScopes)
    .where(eq(leaderboardScopes.id, scopeId))
    .for("update");
  return scope?.status === "open";
}
