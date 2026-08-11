// Loose Zod schema for the Grid.gg seriesState GraphQL response — only the fields the
// state machine needs are typed strictly; everything else is passed through untouched so the
// full raw payload can still be stored verbatim. A malformed response is skipped (logged),
// never fatal — Grid.gg may add fields or occasionally return a partial/error body.

import { z } from "zod";

const SeriesTeamSchema = z
  .object({
    name: z.string().optional(),
    won: z.boolean().optional(),
    // Series-level score (maps won in the best-of series) — NOT the in-game round score.
    score: z.number().optional(),
  })
  .passthrough();

// In-game round score, at data.seriesState.games[].teams[].score — this is what "teams[0].score
// == 0 && teams[1].score == 0" refers to: the round score at the start of a live game.
const GameTeamSchema = z
  .object({
    name: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

const GameSchema = z
  .object({
    teams: z.array(GameTeamSchema).optional(),
  })
  .passthrough();

export const SeriesStateResponseSchema = z
  .object({
    data: z
      .object({
        seriesState: z
          .object({
            teams: z.array(SeriesTeamSchema).optional(),
            games: z.array(GameSchema).optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type SeriesStateResponse = z.infer<typeof SeriesStateResponseSchema>;

/**
 * True once the live game's round score reads 0-0 — the start of a fresh game/map. Read from
 * data.seriesState.games[0].teams[].score (in-game round score), not the series-level
 * maps-won score.
 */
export function isFreshStart(res: SeriesStateResponse): boolean {
  const teams = res.data?.seriesState?.games?.[0]?.teams;
  if (!teams || teams.length < 2) return false;
  return teams[0]?.score === 0 && teams[1]?.score === 0;
}

/** True while there's a currently-live game in the series (the query filters to started && !finished). */
export function hasLiveGame(res: SeriesStateResponse): boolean {
  const games = res.data?.seriesState?.games;
  return Array.isArray(games) && games.length > 0;
}

/** True when the response carries a GraphQL-level error (HTTP 200, but `errors` present / `data` empty). */
export function hasGraphQLErrors(res: SeriesStateResponse): boolean {
  return Array.isArray(res.errors) && res.errors.length > 0;
}
