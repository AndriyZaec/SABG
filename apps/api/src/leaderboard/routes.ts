import { Router } from "express";
import type { Router as RouterType } from "express";
import { z } from "zod";
import {
  STEAM_TRADE_URL_PATTERN,
  type ApiError,
  type PlayerLeaderboardEntry,
  type PlayerLeaderboardMeResponse,
  type PlayerLeaderboardPrizeClaim,
  type PlayerLeaderboardResponse,
  type PlayerTradeUrlResponse,
} from "@arena/contracts";
import {
  leaderboardRepository,
  type LeaderboardEntryView,
  type PlayerPrizeClaim,
} from "../db/repositories/leaderboard.repository.js";
import { requireAuth, type AuthedRequest } from "../gateway/auth.js";
import { assignPrizePlaces } from "./player-ranking.js";

const PLAYER_LEADERBOARD_TOP = 100;

const TradeUrlRequestSchema = z.object({ tradeUrl: z.string().trim().regex(STEAM_TRADE_URL_PATTERN) });

export type PlayerLeaderboardStore = Pick<
  typeof leaderboardRepository,
  | "findShownScope"
  | "listScopeCompetitions"
  | "listPrizes"
  | "topEntries"
  | "entryFor"
  | "findMark"
  | "findPrizeClaim"
  | "setTradeUrl"
>;

function toEntry(row: LeaderboardEntryView, prizePlace?: number): PlayerLeaderboardEntry {
  return {
    userId: row.userId,
    username: row.username,
    ...(row.avatar !== null ? { avatar: row.avatar } : {}),
    rank: row.rank,
    points: row.points,
    wins: row.wins,
    arenasPlayed: row.arenasPlayed,
    disqualified: row.disqualified,
    ...(prizePlace !== undefined ? { prizePlace } : {}),
  };
}

function toPrizeClaim(claim: PlayerPrizeClaim): PlayerLeaderboardPrizeClaim {
  return {
    place: claim.place,
    imageUrl: claim.imageUrl,
    ...(claim.tradeUrl !== null ? { tradeUrl: claim.tradeUrl } : {}),
    sent: claim.sentAt !== null,
  };
}

/** Players see the current scope, or the scope finalized last until another becomes current. */
export function createLeaderboardRouter(store: PlayerLeaderboardStore = leaderboardRepository): RouterType {
  const router = Router();

  router.get<Record<string, never>, PlayerLeaderboardResponse>("/leaderboard", async (_req, res) => {
    const scope = await store.findShownScope();
    if (scope === undefined) {
      res.json({ scope: null });
      return;
    }
    const [competitions, prizes, rows] = await Promise.all([
      store.listScopeCompetitions(scope.id),
      store.listPrizes(scope.id),
      store.topEntries(scope.id, PLAYER_LEADERBOARD_TOP),
    ]);
    const prizePlaces = assignPrizePlaces(rows, prizes.map((prize) => prize.place));
    const computedAt = rows[0]?.computedAt;
    res.json({
      scope: { name: scope.name, finalized: scope.finalizedAt !== null },
      competitions: competitions.map(({ name, shortName, logoUrl }) => ({
        name,
        ...(shortName !== null ? { shortName } : {}),
        ...(logoUrl !== null ? { logoUrl } : {}),
      })),
      prizes: prizes.map(({ place, imageUrl }) => ({ place, imageUrl })),
      entries: rows.map((row) => toEntry(row, prizePlaces.get(row.userId))),
      ...(computedAt !== undefined ? { computedAt: computedAt.toISOString() } : {}),
    });
  });

  router.get<Record<string, never>, PlayerLeaderboardMeResponse>("/leaderboard/me", requireAuth, async (req, res) => {
    const userId = (req as unknown as AuthedRequest).userId;
    const scope = await store.findShownScope();
    if (scope === undefined) {
      res.json({ entry: null });
      return;
    }
    const [row, mark, claim] = await Promise.all([
      store.entryFor(scope.id, userId),
      store.findMark(scope.id, userId),
      scope.finalizedAt !== null ? store.findPrizeClaim(scope.id, userId) : undefined,
    ]);
    res.json({
      entry: row === undefined ? null : toEntry(row),
      ...(mark?.status === "disqualified" && mark.reason !== null ? { disqualificationReason: mark.reason } : {}),
      ...(claim !== undefined ? { prize: toPrizeClaim(claim) } : {}),
    });
  });

  router.post<Record<string, never>, PlayerTradeUrlResponse | ApiError>(
    "/leaderboard/prize/trade-url",
    requireAuth,
    async (req, res) => {
      const userId = (req as unknown as AuthedRequest).userId;
      const parsed = TradeUrlRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request", message: "tradeUrl must be a Steam trade offer link" });
        return;
      }
      // Only the shown finalized scope takes a trade URL, so the form closes once another scope is current.
      const scope = await store.findShownScope();
      const result = scope !== undefined && scope.finalizedAt !== null
        ? await store.setTradeUrl(scope.id, userId, parsed.data.tradeUrl)
        : { kind: "not_found" as const };
      switch (result.kind) {
        case "not_found":
          res.status(404).json({ error: "not_found", message: "No prize to claim" });
          return;
        case "sent":
          res.status(409).json({ error: "prize_sent", message: "The prize has already been sent" });
          return;
        case "saved":
          res.json({ prize: toPrizeClaim(result.claim) });
          return;
      }
    },
  );

  return router;
}
