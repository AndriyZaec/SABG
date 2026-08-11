// Raw GRID `seriesState` GraphQL response -> @arena/contracts Cs2GameSnapshot. Pure, no I/O —
// same envelope shape as `GridClient.fetchSeriesState()`'s `.data` (cs2-migration-spec/spec_v2.md
// §8). Stricter than `grid/series-state.ts` (which only types the minimum the recorder needs):
// this schema requires every field the CS2 settlement catalog reads.

import { z } from "zod";
import type { Cs2GameSnapshot, Cs2TeamStats } from "@arena/contracts";

const WeaponKillSchema = z.object({
  weaponName: z.string(),
  count: z.number(),
});

const PlayerSchema = z.object({
  id: z.string(),
  kills: z.number(),
});

const GameTeamSchema = z.object({
  name: z.string(),
  score: z.number(),
  deaths: z.number(),
  weaponKills: z.array(WeaponKillSchema),
  players: z.array(PlayerSchema),
});

const GameSchema = z.object({
  teams: z.array(GameTeamSchema),
});

const SeriesStateSchema = z
  .object({
    format: z.string().optional(),
    games: z.array(GameSchema).optional(),
  })
  .passthrough();

const RawResponseSchema = z
  .object({
    data: z
      .object({
        seriesState: SeriesStateSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/**
 * Parses one raw GRID response into a diff-able `Cs2GameSnapshot`. Returns `undefined` — never
 * throws — when there's no live game (`games` empty/absent, e.g. between-map warmup or the
 * response's `finished:true` filter already excluded it) or the response doesn't match the
 * expected shape (malformed/partial GraphQL error body). Same safe-skip philosophy as
 * `grid/series-state.ts`'s `hasLiveGame`/`isFreshStart`.
 */
export function parseSnapshot(raw: unknown): Cs2GameSnapshot | undefined {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  const games = parsed.data.data?.seriesState?.games;
  const game = games?.[0];
  if (game === undefined) return undefined;

  // Exactly two teams expected (spec §7 п.7's math assumes a fixed pair) — a response with any
  // other count can't be diffed meaningfully, so treat it the same as "no live game".
  if (game.teams.length !== 2) return undefined;

  const [a, b] = game.teams;
  if (a === undefined || b === undefined) return undefined;

  const toTeamStats = (t: (typeof game.teams)[number]): Cs2TeamStats => ({
    name: t.name,
    score: t.score,
    deaths: t.deaths,
    weaponKills: t.weaponKills,
    players: t.players,
  });

  return { teams: [toTeamStats(a), toTeamStats(b)] };
}

/**
 * The Round number, derived (not a raw GRID field, spec §2): `sum(teams[].score) + 1`. A fresh
 * 0-0 snapshot is Round 1; after the first team wins a round (score sums to 1), it's Round 2.
 */
export function deriveRoundNumber(snapshot: Cs2GameSnapshot): number {
  return snapshot.teams[0].score + snapshot.teams[1].score + 1;
}

/**
 * GRID reports the series format as `"best-of-N"` (e.g. `"best-of-3"`), not the number spec §2
 * expects on `Series.format`. Returns `undefined` for anything that doesn't match — never
 * throws on unexpected upstream input.
 */
export function parseFormat(raw: string | undefined): number | undefined {
  const match = raw?.match(/^best-of-(\d+)$/);
  if (match?.[1] === undefined) return undefined;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
