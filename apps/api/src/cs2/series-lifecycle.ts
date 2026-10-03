// A forfeited map may never appear in games[]; a series-score jump can decide its waiting arena.

import type { IsoDateTime } from "@arena/contracts";
import type { Cs2SeriesSnapshot, Cs2SeriesTeam } from "./series-snapshot.js";

export const LOBBY_OPEN_BEFORE_START_MS = 10 * 60 * 1_000;
const NO_SHOW_TIMEOUT_MS = 60 * 60 * 1_000;

export type Cs2LifecycleAction =
  | { type: "open_arena"; matchIndex: number }
  | { type: "match_live_detected"; matchIndex: number }
  | { type: "match_ended"; matchIndex: number }
  | { type: "series_decided"; reason: "clinch" | "all_maps_played" }
  | { type: "cancel_arena"; matchIndex: number; reason: "no_show" | "series_decided" | "forfeit" };

export interface Cs2SeriesLifecycleState {
  readonly scheduledStartTime: IsoDateTime;
  readonly format: number | undefined;
  readonly openedThrough: number;
  /** When `openedThrough` last advanced; arena #2+'s no-show timeout measures from here. */
  readonly openedThroughAt: IsoDateTime;
  readonly matchLiveDetected: boolean;
  readonly lastHasLiveGame: boolean;
  /** Consecutive polls the forfeit signal has held; resets to 0 when it doesn't. */
  readonly forfeitPendingPolls: number;
  readonly decided: boolean;
  readonly invalid: boolean;
}

/**
 * `startAfterMap1` joins a series whose map 1 is already live: map 1 counts as opened and live, with no arena,
 * so its end opens arena #2 (`match_ended(1)` finds no arena to finish).
 */
export function initialCs2SeriesLifecycleState(
  scheduledStartTime: IsoDateTime,
  options: { startAfterMap1?: true } = {},
): Cs2SeriesLifecycleState {
  const afterMap1 = options.startAfterMap1 === true;
  return {
    scheduledStartTime,
    format: undefined,
    openedThrough: afterMap1 ? 1 : 0,
    openedThroughAt: scheduledStartTime,
    matchLiveDetected: afterMap1,
    lastHasLiveGame: afterMap1,
    forfeitPendingPolls: 0,
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
    next = { ...next, openedThrough: 1, openedThroughAt: now };
  }

  const k = next.openedThrough;

  // Arena #1 measures from the scheduled start; #2+ has no schedule, so from when it opened.
  if (!next.matchLiveDetected && snapshot?.hasLiveGame !== true) {
    const since = k === 1 ? next.scheduledStartTime : next.openedThroughAt;
    if (Date.parse(now) - Date.parse(since) > NO_SHOW_TIMEOUT_MS) {
      actions.push({ type: "cancel_arena", matchIndex: k, reason: "no_show" });
      return { state: { ...next, invalid: true }, actions };
    }
  }

  if (snapshot === undefined) return { state: next, actions };

  // GRID counts match k as decided although we never saw it live: a forfeit (ADR-0006).
  const scoredMaps = snapshot.teams[0].score + snapshot.teams[1].score;
  const forfeitSignal = !next.matchLiveDetected && scoredMaps >= k;
  if (forfeitSignal) {
    const forfeitPendingPolls = next.forfeitPendingPolls + 1;
    if (forfeitPendingPolls >= 2) {
      const decided = isSeriesDecided(next.format, scoredMaps, snapshot.teams);
      actions.push({ type: "cancel_arena", matchIndex: k, reason: decided ? "series_decided" : "forfeit" });
      if (decided) {
        actions.push({ type: "series_decided", reason: decidedReason(next.format as number, snapshot.teams) });
        return { state: { ...next, decided: true, forfeitPendingPolls: 0 }, actions };
      }
      actions.push({ type: "open_arena", matchIndex: k + 1 });
      return {
        state: { ...next, openedThrough: k + 1, openedThroughAt: now, matchLiveDetected: false, forfeitPendingPolls: 0 },
        actions,
      };
    }
    next = { ...next, forfeitPendingPolls };
  } else if (next.forfeitPendingPolls !== 0) {
    next = { ...next, forfeitPendingPolls: 0 };
  }

  if (snapshot.hasLiveGame && !next.lastHasLiveGame) {
    // This live game belongs to k+1; leave the edge unrecorded so it fires for k+1 after the advance.
    if (forfeitSignal) return { state: next, actions };
    actions.push({ type: "match_live_detected", matchIndex: k });
    next = { ...next, matchLiveDetected: true };
  } else if (!snapshot.hasLiveGame && next.lastHasLiveGame) {
    actions.push({ type: "match_ended", matchIndex: k });
    if (isSeriesDecided(next.format, k, snapshot.teams)) {
      actions.push({ type: "series_decided", reason: decidedReason(next.format as number, snapshot.teams) });
      next = { ...next, decided: true };
    } else {
      actions.push({ type: "open_arena", matchIndex: k + 1 });
      next = { ...next, openedThrough: k + 1, openedThroughAt: now, matchLiveDetected: false };
    }
  }

  return { state: { ...next, lastHasLiveGame: snapshot.hasLiveGame }, actions };
}
