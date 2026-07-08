// Raw TXODDS ScoreSnapshot -> @arena/contracts LiveEvent (B1, build plan §S3).
// Pure function per CLAUDE.md: no I/O, fully unit-testable on fixtures.

import { randomUUID } from "node:crypto";
import type { LiveEvent, TeamSide } from "@arena/contracts";
import { isClockedStatus, type ScoreSnapshot } from "./score-snapshot.js";
import { targetEventTypeForAction } from "./whitelist.js";

/**
 * Derives the match minute from `Clock.Seconds` and `StatusId` (current phase).
 *
 * Despite the TXODDS docs describing `Clock.Seconds` as "seconds remaining in the period",
 * the recorded fixture (18179764) shows it's actually *elapsed* seconds since kickoff,
 * accumulating continuously across periods (confirmed at the H1/H2 boundary: H1 ends at
 * ~3069s — 45' + stoppage — then a `clock_adjustment` snaps it to exactly 2700s = 45:00 and
 * H2 continues counting up from there). So no per-period base offset is needed: the minute
 * is simply the elapsed seconds converted to minutes, which already folds in stoppage time.
 *
 * Returns `undefined` when there isn't enough information (no clock, or a non-clocked phase
 * like NS/HT/finished).
 */
export function deriveMinute(
  statusId: number | undefined,
  clockSeconds: number | undefined,
): number | undefined {
  if (statusId === undefined || clockSeconds === undefined) return undefined;
  if (!isClockedStatus(statusId)) return undefined;
  return Math.ceil(clockSeconds / 60);
}

/** Maps a `Participant` (1|2) reference to home/away using `Participant1IsHome`. */
export function participantToSide(
  participant: number | undefined,
  participant1IsHome: boolean | undefined,
): TeamSide | undefined {
  if (participant !== 1 && participant !== 2) return undefined;
  const isHome = participant1IsHome ?? true;
  if (participant === 1) return isHome ? "home" : "away";
  return isHome ? "away" : "home";
}

/**
 * Normalizes one raw feed message into a `LiveEvent`, or returns `null` when the message
 * should be dropped: non-whitelisted `Action` (spec §4.1, e.g. possession/throw_in/free_kick),
 * or a match minute that can't be derived (event fired outside a clocked period).
 */
export function normalizeEvent(matchId: string, raw: ScoreSnapshot): LiveEvent | null {
  const eventType = targetEventTypeForAction(raw.Action);
  if (eventType === undefined) return null;

  const matchMinute = deriveMinute(raw.StatusId, raw.Clock?.Seconds);
  if (matchMinute === undefined) return null;

  const team = participantToSide(raw.Participant, raw.Participant1IsHome) ?? "any";
  const timestamp = raw.Ts !== undefined ? new Date(raw.Ts).toISOString() : new Date().toISOString();

  return {
    id: randomUUID(),
    matchId,
    eventType,
    team,
    matchMinute,
    timestamp,
    confirmed: raw.Confirmed === true,
    rawPayload: raw,
  };
}
