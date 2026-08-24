// Raw GRID `seriesState` GraphQL response -> @arena/contracts Cs2GameSnapshot. Pure, no I/O —
// same envelope shape as `GridClient.fetchSeriesState()`'s `.data` (cs2-migration-spec/spec_v2.md
// §8). Stricter than `grid/series-state.ts` (which only types the minimum the recorder needs):
// this schema requires every field the CS2 settlement catalog reads.

import { z } from "zod";
import type { Cs2Clock, Cs2GameSnapshot, Cs2TeamStats } from "@arena/contracts";

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

const ClockSchema = z.object({
  ticking: z.boolean(),
  currentSeconds: z.number(),
});

const GameSchema = z.object({
  clock: ClockSchema,
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

export type Cs2SnapshotObservation =
  | { kind: "live"; snapshot: Cs2GameSnapshot }
  | { kind: "no_live_game" }
  | { kind: "invalid" };

/** Distinguishes an explicit empty game list from malformed upstream data. Only the former is
 * evidence that a previously-live map ended; invalid data must leave the tracker untouched. */
export function observeSnapshot(raw: unknown): Cs2SnapshotObservation {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid" };

  const games = parsed.data.data?.seriesState?.games;
  if (games === undefined) return { kind: "invalid" };
  if (games.length === 0) return { kind: "no_live_game" };

  const game = games?.[0];
  if (game === undefined) return { kind: "invalid" };

  // Exactly two teams expected (spec §7 п.7's math assumes a fixed pair) — a response with any
  // other count can't be diffed meaningfully and is not evidence that the map ended.
  if (game.teams.length !== 2) return { kind: "invalid" };

  const [a, b] = game.teams;
  if (a === undefined || b === undefined) return { kind: "invalid" };

  const toTeamStats = (t: (typeof game.teams)[number]): Cs2TeamStats => ({
    name: t.name,
    score: t.score,
    deaths: t.deaths,
    weaponKills: t.weaponKills,
    players: t.players,
  });

  return { kind: "live", snapshot: { teams: [toTeamStats(a), toTeamStats(b)], clock: game.clock } };
}

/** Convenience parser for fixture/settlement callers that only consume live snapshots. */
export function parseSnapshot(raw: unknown): Cs2GameSnapshot | undefined {
  const observation = observeSnapshot(raw);
  return observation.kind === "live" ? observation.snapshot : undefined;
}

/**
 * Seconds `currentSeconds` must jump upward by, between two consecutive live snapshots, to count
 * as "a new round just went live" rather than normal within-round countdown/noise. Chosen from
 * the observed data: freezetime is ≤ ~20s and the live round clock resets to ~104-115s, so any
 * threshold between those (30s, with margin) cleanly separates the two — verified against every
 * round boundary in the recorded fixture with zero false positives/negatives
 * (cs2-migration-spec/data-assumptions.md #1-#2). Re-check that doc before changing this.
 */
const ROUND_RESET_THRESHOLD_SECONDS = 30;

/**
 * True when `after` is the first snapshot of a newly-live round relative to `before` — the
 * Round Lock signal (spec §2: "кінець freezetime поточного раунду"). Detected as an upward jump
 * in `currentSeconds` (freezetime's short countdown ending and the full round clock starting)
 * combined with `ticking: true` (excludes the initial warmup/halftime `paused` windows, where
 * `currentSeconds` sits flat and non-ticking).
 */
export function isRoundLive(before: Cs2GameSnapshot, after: Cs2GameSnapshot): boolean {
  return after.clock.ticking && after.clock.currentSeconds > before.clock.currentSeconds + ROUND_RESET_THRESHOLD_SECONDS;
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
