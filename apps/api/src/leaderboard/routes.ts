import { Router } from "express";
import type { Router as RouterType } from "express";
import type { PlayerLeaderboardEntry, PlayerLeaderboardMeResponse, PlayerLeaderboardResponse } from "@arena/contracts";
import { leaderboardRepository, type LeaderboardEntryView } from "../db/repositories/leaderboard.repository.js";
import { requireAuth, type AuthedRequest } from "../gateway/auth.js";

const PLAYER_LEADERBOARD_TOP = 100;

export type PlayerLeaderboardStore = Pick<typeof leaderboardRepository, "findCurrent" | "listScopeCompetitions" | "topEntries" | "entryFor">;

function toEntry(row: LeaderboardEntryView): PlayerLeaderboardEntry {
  return {
    userId: row.userId,
    username: row.username,
    ...(row.avatar !== null ? { avatar: row.avatar } : {}),
    rank: row.rank,
    points: row.points,
    wins: row.wins,
    arenasPlayed: row.arenasPlayed,
  };
}

/** Players only ever see the current scope; closed scopes stay admin-only. */
export function createLeaderboardRouter(store: PlayerLeaderboardStore = leaderboardRepository): RouterType {
  const router = Router();

  router.get<Record<string, never>, PlayerLeaderboardResponse>("/leaderboard", async (_req, res) => {
    const scope = await store.findCurrent();
    if (scope === undefined) {
      res.json({ scope: null });
      return;
    }
    const [competitions, rows] = await Promise.all([
      store.listScopeCompetitions(scope.id),
      store.topEntries(scope.id, PLAYER_LEADERBOARD_TOP),
    ]);
    const computedAt = rows[0]?.computedAt;
    res.json({
      scope: { name: scope.name },
      competitions: competitions.map(({ name, shortName, logoUrl }) => ({
        name,
        ...(shortName !== null ? { shortName } : {}),
        ...(logoUrl !== null ? { logoUrl } : {}),
      })),
      entries: rows.map(toEntry),
      ...(computedAt !== undefined ? { computedAt: computedAt.toISOString() } : {}),
    });
  });

  router.get<Record<string, never>, PlayerLeaderboardMeResponse>("/leaderboard/me", requireAuth, async (req, res) => {
    const userId = (req as unknown as AuthedRequest).userId;
    const scope = await store.findCurrent();
    const row = scope === undefined ? undefined : await store.entryFor(scope.id, userId);
    res.json({ entry: row === undefined ? null : toEntry(row) });
  });

  return router;
}
