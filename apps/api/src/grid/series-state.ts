// Unknown fields pass through so recorded payloads remain intact.

import { z } from "zod";

const SeriesTeamSchema = z
  .object({
    name: z.string().optional(),
    won: z.boolean().optional(),
    // Series score counts maps won, not rounds won in the live game.
    score: z.number().optional(),
  })
  .passthrough();

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

/** Reads the live game's round score, not the series score. */
export function isFreshStart(res: SeriesStateResponse): boolean {
  const teams = res.data?.seriesState?.games?.[0]?.teams;
  if (!teams || teams.length < 2) return false;
  return teams[0]?.score === 0 && teams[1]?.score === 0;
}

export function hasLiveGame(res: SeriesStateResponse): boolean {
  const games = res.data?.seriesState?.games;
  return Array.isArray(games) && games.length > 0;
}

export function hasGraphQLErrors(res: SeriesStateResponse): boolean {
  return Array.isArray(res.errors) && res.errors.length > 0;
}
