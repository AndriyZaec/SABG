// Series -> Arena lifecycle (cs2-migration-spec/spec_v2.md §4). Pure reducer, same shape as
// round-tracker.ts's trackCs2Poll: `(state, snapshot, now) => { state, actions }`, fed one
// series-level poll at a time (parseSeriesSnapshot, series-snapshot.ts). No I/O, no `Date.now()`
// — `now` always arrives as an argument so a recorded/synthetic poll stream replays
// deterministically.
//
// Why this needs no scheduler: GRID is already polled every ~10s (grid/recorder.ts today, a live
// GameSource later), so both time-based rules in §4 ("Arena #1 opens 10 min before
// scheduledStartTime", "no-show after 60 min") are just comparisons against `now` on each poll,
// not timers. No cron/setInterval infrastructure is needed here or in a later persistence step.
//
// Forfeit handling (data-assumptions.md #12): a forfeited map never produces a `games[]` entry —
// no warmup, no Match Live Detected — so it's invisible to per-map state. The only signal is a
// discontinuous jump in the series-level envelope this module reads (`teams[].score` jumping,
// `finished` flipping). This reducer watches for "the series is already decided while the current
// Arena has never gone live" on every poll (not just on a hasLiveGame edge) specifically to catch
// that case quickly (~one poll interval) instead of falling back to a long no-show-style timeout.

import type { IsoDateTime } from "@arena/contracts";
import type { Cs2SeriesSnapshot, Cs2SeriesTeam } from "./series-snapshot.js";

const LOBBY_OPEN_BEFORE_START_MS = 10 * 60 * 1_000;
const NO_SHOW_TIMEOUT_MS = 60 * 60 * 1_000;

export type Cs2LifecycleAction =
  /** Create Arena #matchIndex in `lobby` (spec §4 п.1/п.2). */
  | { type: "open_arena"; matchIndex: number }
  /** GRID's Game object for Match #matchIndex first appeared (spec §2) — join-gate closes, the
   *  round cascade starts (Cs2RoundEngine.onMatchLiveDetected). */
  | { type: "match_live_detected"; matchIndex: number }
  /** Match #matchIndex's live game disappeared from GRID (spec §7 п.3). */
  | { type: "match_ended"; matchIndex: number }
  /** No further Arena will be created for this Series — either normal resolution or a forfeit
   *  discovered before the next Arena's Match ever went live. */
  | { type: "series_decided"; reason: "clinch" | "all_maps_played" }
  /** Arena #matchIndex should be cancelled/refunded. `"no_show"` is spec §4 п.4 (Arena #1 only,
   *  60-min timeout from scheduledStartTime). `"series_decided"` is the forfeit case above — the
   *  Arena was opened reactively but its Match never went live before the Series was already
   *  decided some other way. Actually performing the cancellation/refund is a later step (spec
   *  gap, tracked in data-assumptions.md — "Arena #k+1 forfeit-cancellation gap"); this reducer
   *  only emits the action. */
  | { type: "cancel_arena"; matchIndex: number; reason: "no_show" | "series_decided" };

export interface Cs2SeriesLifecycleState {
  readonly scheduledStartTime: IsoDateTime;
  /** GRID reports format as "best-of-N" (parseFormat, snapshot.ts already does the string parse;
   *  series-snapshot.ts reuses it). Learned from the first snapshot that carries it — undefined
   *  until then. Without it, "decided" can never be computed, so no Arena beyond #1 would ever
   *  be judged unnecessary; series-snapshot.ts always sends it when GRID does, so this should
   *  resolve on the very first poll in practice. */
  readonly format: number | undefined;
  /** Highest Arena/Match index opened so far. 0 = Arena #1 not yet opened. */
  readonly openedThrough: number;
  /** Whether Match #openedThrough has itself seen Match Live Detected. */
  readonly matchLiveDetected: boolean;
  /** hasLiveGame as of the last poll — used to detect the MLD/match-end edges. */
  readonly lastHasLiveGame: boolean;
  /** Terminal: the Series is definitively resolved (clinch, all maps played, or a forfeit
   *  discovered pre-MLD). No further actions are ever emitted once true. */
  readonly decided: boolean;
  /** Terminal: Arena #1's Match never went live within the no-show window. Distinct from
   *  `decided` — mirrors SeriesStatus's own "decided" vs "invalid" split (enums.ts). */
  readonly invalid: boolean;
}

export function initialCs2SeriesLifecycleState(scheduledStartTime: IsoDateTime): Cs2SeriesLifecycleState {
  return {
    scheduledStartTime,
    format: undefined,
    openedThrough: 0,
    matchLiveDetected: false,
    lastHasLiveGame: false,
    decided: false,
    invalid: false,
  };
}

/** `floor(format/2) + 1` (spec §4 п.3). Needs both this and `matchesCompleted >= format` — Bo2
 *  is the case that splits them (a 1-1 draw never reaches winsNeeded=2, only the "all maps
 *  played" side catches it; odd formats always have both agree). */
function winsNeeded(format: number): number {
  return Math.floor(format / 2) + 1;
}

function isSeriesDecided(
  format: number | undefined,
  matchesCompleted: number,
  teams: readonly [Cs2SeriesTeam, Cs2SeriesTeam],
): boolean {
  if (format === undefined) return false;
  if (matchesCompleted >= format) return true;
  const needed = winsNeeded(format);
  return teams.some((t) => t.score >= needed);
}

function decidedReason(format: number, teams: readonly [Cs2SeriesTeam, Cs2SeriesTeam]): "clinch" | "all_maps_played" {
  return teams.some((t) => t.score >= winsNeeded(format)) ? "clinch" : "all_maps_played";
}

/**
 * Feeds one series-level poll through the lifecycle reducer. `snapshot` is `undefined` when
 * `parseSeriesSnapshot` couldn't parse this poll (malformed/partial response) — treated as "no
 * signal this poll", never as evidence of anything.
 */
export function processCs2SeriesPoll(
  state: Cs2SeriesLifecycleState,
  snapshot: Cs2SeriesSnapshot | undefined,
  now: IsoDateTime,
): { state: Cs2SeriesLifecycleState; actions: Cs2LifecycleAction[] } {
  if (state.decided || state.invalid) return { state, actions: [] }; // terminal

  const actions: Cs2LifecycleAction[] = [];
  let next = state;

  if (snapshot?.format !== undefined && snapshot.format !== next.format) {
    next = { ...next, format: snapshot.format };
  }

  if (next.openedThrough === 0) {
    if (Date.parse(now) < Date.parse(next.scheduledStartTime) - LOBBY_OPEN_BEFORE_START_MS) {
      return { state: next, actions }; // too early — Arena #1 doesn't exist yet, nothing else can happen
    }
    actions.push({ type: "open_arena", matchIndex: 1 });
    next = { ...next, openedThrough: 1 };
  }

  const k = next.openedThrough;

  // No-show (spec §4 п.4) is scoped to Arena #1 only — Arena #k+1 (k>=2) never sits waiting on a
  // scheduledStartTime of its own, so it's covered by the forfeit/decided check below instead.
  if (k === 1 && !next.matchLiveDetected) {
    if (Date.parse(now) - Date.parse(next.scheduledStartTime) > NO_SHOW_TIMEOUT_MS) {
      actions.push({ type: "cancel_arena", matchIndex: 1, reason: "no_show" });
      return { state: { ...next, invalid: true }, actions };
    }
  }

  if (snapshot === undefined) return { state: next, actions };

  if (!next.matchLiveDetected) {
    // Matches completed so far, not counting the current (never-live) Arena's Match.
    const matchesCompleted = k - 1;
    if (isSeriesDecided(next.format, matchesCompleted, snapshot.teams)) {
      // The Series resolved (most likely a forfeit — data-assumptions.md #12) before this
      // Arena's Match ever went live. Cancel it instead of leaving it stranded in lobby.
      actions.push({ type: "cancel_arena", matchIndex: k, reason: "series_decided" });
      actions.push({ type: "series_decided", reason: decidedReason(next.format as number, snapshot.teams) });
      return { state: { ...next, decided: true }, actions };
    }
  }

  if (snapshot.hasLiveGame && !next.lastHasLiveGame) {
    actions.push({ type: "match_live_detected", matchIndex: k });
    next = { ...next, matchLiveDetected: true };
  } else if (!snapshot.hasLiveGame && next.lastHasLiveGame) {
    actions.push({ type: "match_ended", matchIndex: k });
    if (isSeriesDecided(next.format, k, snapshot.teams)) {
      actions.push({ type: "series_decided", reason: decidedReason(next.format as number, snapshot.teams) });
      next = { ...next, decided: true };
    } else {
      actions.push({ type: "open_arena", matchIndex: k + 1 });
      next = { ...next, openedThrough: k + 1, matchLiveDetected: false };
    }
  }

  return { state: { ...next, lastHasLiveGame: snapshot.hasLiveGame }, actions };
}
