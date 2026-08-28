// A forfeited map may never appear in games[]; a series-score jump can decide its waiting arena.

import type { IsoDateTime } from "@arena/contracts";
import type { Cs2SeriesSnapshot, Cs2SeriesTeam } from "./series-snapshot.js";

const LOBBY_OPEN_BEFORE_START_MS = 10 * 60 * 1_000;
const NO_SHOW_TIMEOUT_MS = 60 * 60 * 1_000;

export type Cs2LifecycleAction =
  | { type: "open_arena"; matchIndex: number }
  | { type: "match_live_detected"; matchIndex: number }
  | { type: "match_ended"; matchIndex: number }
  | { type: "series_decided"; reason: "clinch" | "all_maps_played" }
  | { type: "cancel_arena"; matchIndex: number; reason: "no_show" | "series_decided" };

export interface Cs2SeriesLifecycleState {
  readonly scheduledStartTime: IsoDateTime;
  readonly format: number | undefined;
  readonly openedThrough: number;
  readonly matchLiveDetected: boolean;
  readonly lastHasLiveGame: boolean;
  readonly decided: boolean;
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

/** A malformed snapshot is no signal and never evidence of a lifecycle transition. */
export function processCs2SeriesPoll(
  state: Cs2SeriesLifecycleState,
  snapshot: Cs2SeriesSnapshot | undefined,
  now: IsoDateTime,
): { state: Cs2SeriesLifecycleState; actions: Cs2LifecycleAction[] } {
  if (state.decided || state.invalid) return { state, actions: [] };

  const actions: Cs2LifecycleAction[] = [];
  let next = state;

  if (snapshot?.format !== undefined && snapshot.format !== next.format) {
    next = { ...next, format: snapshot.format };
  }

  if (next.openedThrough === 0) {
    if (Date.parse(now) < Date.parse(next.scheduledStartTime) - LOBBY_OPEN_BEFORE_START_MS) {
      return { state: next, actions };
    }
    actions.push({ type: "open_arena", matchIndex: 1 });
    next = { ...next, openedThrough: 1 };
  }

  const k = next.openedThrough;

  // Only the first arena has a scheduled start from which to measure no-show.
  if (k === 1 && !next.matchLiveDetected && snapshot?.hasLiveGame !== true) {
    if (Date.parse(now) - Date.parse(next.scheduledStartTime) > NO_SHOW_TIMEOUT_MS) {
      actions.push({ type: "cancel_arena", matchIndex: 1, reason: "no_show" });
      return { state: { ...next, invalid: true }, actions };
    }
  }

  if (snapshot === undefined) return { state: next, actions };

  if (!next.matchLiveDetected) {
    const matchesCompleted = k - 1;
    if (isSeriesDecided(next.format, matchesCompleted, snapshot.teams)) {
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
