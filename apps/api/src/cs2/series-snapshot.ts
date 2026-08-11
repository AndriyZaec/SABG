// Raw GRID `seriesState` GraphQL response -> a series-level snapshot. Sibling to snapshot.ts,
// which only reads `games[0]` (the live map's state) — this module reads the top-level envelope
// instead: `format`, `finished`, `teams[].score/won` (maps-won, NOT the in-game round score) and
// whether a game is currently live at all. That envelope is what a forfeit surfaces through: a
// forfeited map produces *no* `games[]` entry at all (no warmup, no Match Live Detected) — the
// only signal is a discontinuous jump here (`teams[].score` jumping by more than one, `finished`
// flipping true) — see cs2-migration-spec/data-assumptions.md #12. series-lifecycle.ts is the
// only consumer; grid/series-state.ts is a separate, deliberately looser schema serving the
// recorder and is not reused here (this schema needs `won`/`finished`, which the recorder does
// not).

import { z } from "zod";
import { parseFormat } from "./snapshot.js";

const SeriesTeamSchema = z.object({
  name: z.string(),
  /** Maps won so far in the series — NOT the in-game round score (that's games[0].teams[].score). */
  score: z.number(),
  won: z.boolean(),
});

const SeriesStateSchema = z
  .object({
    format: z.string().optional(),
    finished: z.boolean(),
    teams: z.array(SeriesTeamSchema),
    games: z.array(z.unknown()).optional(),
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

export interface Cs2SeriesTeam {
  name: string;
  /** Maps won in the series so far. */
  score: number;
  won: boolean;
}

export interface Cs2SeriesSnapshot {
  /** `undefined` if GRID's `format` string doesn't parse (parseFormat, snapshot.ts) — series
   *  lifecycle can't decide "decided" without it, so callers should treat this as unusable. */
  format: number | undefined;
  finished: boolean;
  /** True iff `games[]` is non-empty — the raw form of Match Live Detected / Match End (spec §2). */
  hasLiveGame: boolean;
  /** Always exactly two teams — same convention as snapshot.ts's Cs2GameSnapshot.teams. */
  teams: readonly [Cs2SeriesTeam, Cs2SeriesTeam];
}

/**
 * Parses one raw GRID response's series-level envelope. Returns `undefined` — never throws — on
 * a malformed/partial payload or a team count other than two, same safe-skip philosophy as
 * snapshot.ts's parseSnapshot.
 */
export function parseSeriesSnapshot(raw: unknown): Cs2SeriesSnapshot | undefined {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  const seriesState = parsed.data.data?.seriesState;
  if (seriesState === undefined || seriesState === null) return undefined;
  if (seriesState.teams.length !== 2) return undefined;

  const [a, b] = seriesState.teams;
  if (a === undefined || b === undefined) return undefined;

  return {
    format: parseFormat(seriesState.format),
    finished: seriesState.finished,
    hasLiveGame: Array.isArray(seriesState.games) && seriesState.games.length > 0,
    teams: [a, b],
  };
}
