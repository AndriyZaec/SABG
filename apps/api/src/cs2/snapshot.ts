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

/** Only an explicit empty game list is evidence that a live map ended. */
export function observeSnapshot(raw: unknown): Cs2SnapshotObservation {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid" };

  const games = parsed.data.data?.seriesState?.games;
  if (games === undefined) return { kind: "invalid" };
  if (games.length === 0) return { kind: "no_live_game" };

  const game = games?.[0];
  if (game === undefined) return { kind: "invalid" };

  // A non-pair cannot be diffed and is not evidence that the map ended.
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

export function parseSnapshot(raw: unknown): Cs2GameSnapshot | undefined {
  const observation = observeSnapshot(raw);
  return observation.kind === "live" ? observation.snapshot : undefined;
}

// Separates the short freeze-time clock from the reset live-round clock.
const ROUND_RESET_THRESHOLD_SECONDS = 30;

/** Detects the freeze-time to live-round clock reset; ticking excludes paused warmup and halftime. */
export function isRoundLive(before: Cs2GameSnapshot, after: Cs2GameSnapshot): boolean {
  return after.clock.ticking && after.clock.currentSeconds > before.clock.currentSeconds + ROUND_RESET_THRESHOLD_SECONDS;
}

/** GRID does not expose this directly; 0-0 is round 1. */
export function deriveRoundNumber(snapshot: Cs2GameSnapshot): number {
  return snapshot.teams[0].score + snapshot.teams[1].score + 1;
}

export function parseFormat(raw: string | undefined): number | undefined {
  const match = raw?.match(/^best-of-(\d+)$/);
  if (match?.[1] === undefined) return undefined;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
