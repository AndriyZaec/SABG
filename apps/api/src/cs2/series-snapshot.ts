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

const MapScoresSchema = z.array(z.object({
  sequenceNumber: z.union([z.string().regex(/^\d+$/), z.number().int()])
    .transform(Number).pipe(z.number().int().positive()),
  finished: z.boolean(),
  teams: z.tuple([
    z.object({ id: z.string().min(1), score: z.number().int().nonnegative() }),
    z.object({ id: z.string().min(1), score: z.number().int().nonnegative() }),
  ]),
}));

const DraftActionSchema = z.object({
  type: z.string(),
  sequenceNumber: z.string(),
  draftable: z.object({
    type: z.string(),
    name: z.string(),
  }),
});

const SeriesStateSchema = z
  .object({
    format: z.string().optional(),
    finished: z.boolean(),
    teams: z.array(SeriesTeamSchema),
    games: z.array(z.unknown()).optional(),
    draftActions: z.array(DraftActionSchema).optional(),
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
  mapNames: string[];
}

export interface Cs2SeriesSnapshot {
  format: number | undefined;
  finished: boolean;
  hasLiveGame: boolean;
  teams: readonly [Cs2SeriesTeam, Cs2SeriesTeam];
  mapNames: string[];
  mapScores?: readonly Cs2SeriesMapScore[];
}

export interface Cs2SeriesMapScore {
  matchIndex: number;
  finished: boolean;
  teams: readonly [{ teamId: string; score: number }, { teamId: string; score: number }];
}

function parseMapScores(raw: unknown, identities: Cs2TeamIdentityMap): Cs2SeriesMapScore[] | undefined {
  const envelope = RawResponseSchema.safeParse(raw);
  const parsed = MapScoresSchema.safeParse(envelope.success ? envelope.data.data?.seriesState?.["mapScores"] : undefined);
  if (!parsed.success) return undefined;
  const scores: Cs2SeriesMapScore[] = [];
  const indices = new Set<number>();
  for (const map of parsed.data) {
    const first = identities.get(map.teams[0].id);
    const second = identities.get(map.teams[1].id);
    if (!first || !second || first.teamId === second.teamId || indices.has(map.sequenceNumber)) return undefined;
    indices.add(map.sequenceNumber);
    scores.push({
      matchIndex: map.sequenceNumber,
      finished: map.finished,
      teams: [
        { teamId: first.teamId, score: map.teams[0].score },
        { teamId: second.teamId, score: map.teams[1].score },
      ],
    });
  }
  return scores;
}

/** Picked map names in play order (map 1 first); bans and side picks are ignored. */
export function mapNamesFromDraftActions(draftActions: z.infer<typeof DraftActionSchema>[] | undefined): string[] {
  if (draftActions === undefined) return [];
  return draftActions
    .filter((action) => action.type === "pick" && action.draftable.type === "map")
    .sort((a, b) => Number(a.sequenceNumber) - Number(b.sequenceNumber))
    .map((action) => action.draftable.name);
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
    mapNames: mapNamesFromDraftActions(seriesState.draftActions),
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

  const mapScores = parseMapScores(raw, identities);
  return { ...snapshot, teams: [first, second], ...(mapScores !== undefined ? { mapScores } : {}) };
}
