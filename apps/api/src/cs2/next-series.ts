// The launcher's candidate rule (ADR-0008 §2): earliest start, then priority, follows, random.

import type { IsoDateTime, SeriesStatus, Uuid } from "@arena/contracts";
import { LOBBY_OPEN_BEFORE_START_MS } from "./series-lifecycle.js";

/** A series whose start passed at most this long ago can still be launched (the 0:0 rule decides on priming). */
export const LATE_START_WINDOW_MS = 30 * 60 * 1_000;

export interface Cs2SeriesCandidate {
  seriesId: Uuid;
  scheduledStartTime: IsoDateTime;
  priority: boolean;
  followerCount: number;
  /** Full live data and two distinct known teams, from the DB. */
  selectable: boolean;
  status: SeriesStatus;
  hasArena: boolean;
  skipRequested: boolean;
}

export type Cs2NextSeries =
  | { kind: "launch"; seriesId: Uuid }
  | { kind: "wait"; seriesId: Uuid; at: IsoDateTime }
  | { kind: "none" };

export function selectNextSeries(
  candidates: readonly Cs2SeriesCandidate[],
  now: IsoDateTime,
  random: () => number,
): Cs2NextSeries {
  const nowMs = Date.parse(now);
  const eligible = candidates.filter(
    (c) =>
      c.selectable &&
      c.status === "active" &&
      !c.hasArena &&
      !c.skipRequested &&
      Date.parse(c.scheduledStartTime) >= nowMs - LATE_START_WINDOW_MS,
  );
  if (eligible.length === 0) return { kind: "none" };

  const earliest = Math.min(...eligible.map((c) => Date.parse(c.scheduledStartTime)));
  const tied = eligible
    .filter((c) => Date.parse(c.scheduledStartTime) === earliest)
    .map((c) => ({ c, tiebreak: random() }))
    .sort(
      (a, b) =>
        Number(b.c.priority) - Number(a.c.priority) ||
        b.c.followerCount - a.c.followerCount ||
        a.tiebreak - b.tiebreak,
    );
  const winner = tied[0]!.c;

  const launchAt = earliest - LOBBY_OPEN_BEFORE_START_MS;
  if (nowMs >= launchAt) return { kind: "launch", seriesId: winner.seriesId };
  return { kind: "wait", seriesId: winner.seriesId, at: new Date(launchAt).toISOString() };
}
