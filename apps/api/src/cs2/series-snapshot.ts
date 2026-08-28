import { z } from "zod";
import { parseFormat } from "./snapshot.js";
import type { Cs2TeamIdentityMap } from "./team-identity.js";

const SeriesTeamSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Maps won, not the live game's round score. */
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
  teamId: string;
  name: string;
  score: number;
  won: boolean;
}

export interface GridCs2SeriesTeam {
  gridTeamId: string;
  name: string;
  score: number;
  won: boolean;
}

export interface GridCs2SeriesSnapshot {
  format: number | undefined;
  finished: boolean;
  hasLiveGame: boolean;
  teams: readonly [GridCs2SeriesTeam, GridCs2SeriesTeam];
}

export interface Cs2SeriesSnapshot {
  format: number | undefined;
  finished: boolean;
  hasLiveGame: boolean;
  teams: readonly [Cs2SeriesTeam, Cs2SeriesTeam];
}

/** Malformed or partial payloads are skipped rather than interpreted as series state. */
export function parseGridSeriesSnapshot(raw: unknown): GridCs2SeriesSnapshot | undefined {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  const seriesState = parsed.data.data?.seriesState;
  if (seriesState === undefined || seriesState === null) return undefined;
  if (seriesState.teams.length !== 2) return undefined;

  const [a, b] = seriesState.teams;
  if (a === undefined || b === undefined) return undefined;
  if (a.id === b.id) return undefined;

  const toSeriesTeam = (team: typeof a): GridCs2SeriesTeam => ({
    gridTeamId: team.id,
    name: team.name,
    score: team.score,
    won: team.won,
  });

  return {
    format: parseFormat(seriesState.format),
    finished: seriesState.finished,
    hasLiveGame: Array.isArray(seriesState.games) && seriesState.games.length > 0,
    teams: [toSeriesTeam(a), toSeriesTeam(b)],
  };
}

export function parseSeriesSnapshot(
  raw: unknown,
  identities: Cs2TeamIdentityMap,
): Cs2SeriesSnapshot | undefined {
  const snapshot = parseGridSeriesSnapshot(raw);
  if (snapshot === undefined) return undefined;

  const teams = snapshot.teams.map((team) => {
    const identity = identities.get(team.gridTeamId);
    return identity === undefined
      ? undefined
      : { teamId: identity.teamId, name: identity.name, score: team.score, won: team.won };
  });
  const [first, second] = teams;
  if (first === undefined || second === undefined || first.teamId === second.teamId) return undefined;

  return { ...snapshot, teams: [first, second] };
}
