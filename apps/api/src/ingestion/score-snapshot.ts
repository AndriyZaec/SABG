// Raw TXODDS Soccer Scores feed shape (ported from the world-cup draft project's
// scores-stream connector). This is the wire format B1 normalizes into @arena/contracts
// LiveEvent — see normalize.ts. Kept loose/passthrough because real payloads have included
// `Action` values not in the current TXODDS doc revision.

import { z } from "zod";

/**
 * Per TXODDS Scores Product API docs (Soccer v1.0): StatusId is the canonical
 * game-phase indicator. GameState on the fixture envelope is NOT reliable for
 * live phase (observed to stay "scheduled" for the entire match in practice).
 *
 * Single source of truth for status-id semantics — `clocked` (a live running match clock,
 * used by normalize.ts's `deriveMinute`) and `finished` (used by `isFinishedStatus`) are
 * derived from this one table rather than kept as separately hand-maintained id sets.
 */
export const STATUS_ID_INFO: Record<number, { label: string; clocked?: true; finished?: true }> = {
  1: { label: "NS" }, // Not Started
  2: { label: "H1", clocked: true }, // 1st Half
  3: { label: "HT" }, // Half Time
  4: { label: "H2", clocked: true }, // 2nd Half
  5: { label: "F", finished: true }, // Finished (Full-Time)
  6: { label: "WET" }, // Waiting for Extra Time
  7: { label: "ET1", clocked: true }, // 1st Half Extra Time
  8: { label: "HTET" }, // HT Extra Time
  9: { label: "ET2", clocked: true }, // 2nd Half Extra Time
  10: { label: "FET", finished: true }, // Finished (Full-Time) After Extra Time
  11: { label: "WPE" }, // Waiting for Penalty Shootout
  12: { label: "PE" }, // Penalty Shootout
  13: { label: "FPE", finished: true }, // Finished After Penalty Shootout
  14: { label: "I" }, // Interrupted
  15: { label: "A", finished: true }, // Abandoned
  16: { label: "C", finished: true }, // Cancelled
  17: { label: "TXCC", finished: true }, // TX Coverage Cancelled
  18: { label: "TXCS", finished: true }, // TX Coverage Suspended
};

export function isFinishedStatus(statusId: number | undefined): boolean {
  return statusId !== undefined && STATUS_ID_INFO[statusId]?.finished === true;
}

/** True for StatusIds where `Clock.Seconds` is a live, running match clock (H1/H2/ET1/ET2). */
export function isClockedStatus(statusId: number | undefined): boolean {
  return statusId !== undefined && STATUS_ID_INFO[statusId]?.clocked === true;
}

/** Game clock — Running flag + a raw seconds counter (semantics vary by period/build). */
export const ClockSchema = z
  .object({
    Running: z.boolean().optional(),
    Seconds: z.number().optional(),
  })
  .passthrough();

/**
 * One action message (an element of the TXODDS scores stream/snapshot). `Action` is kept
 * as a free string rather than a strict enum: the docs list ~40 known values, but real
 * payloads have included values not in the current doc revision (e.g. `game_finalised`,
 * `halftime_finalised`) — passthrough/string keeps us robust to that drift instead of
 * rejecting valid-but-undocumented messages.
 */
export const ScoreSnapshotSchema = z
  .object({
    FixtureId: z.number(),
    Action: z.string().optional(),
    Id: z.number().optional(), // action id (repeats across amend/confirm messages)
    Seq: z.number().optional(), // per-fixture update sequence number
    Ts: z.number().optional(), // epoch ms — the authoritative ordering key
    StatusId: z.number().optional(), // see STATUS_ID_INFO
    Confirmed: z.boolean().optional(),

    Participant1IsHome: z.boolean().optional(),
    Participant1Id: z.number().optional(),
    Participant2Id: z.number().optional(),

    Clock: ClockSchema.optional(),
    Participant: z.number().optional(), // team ref (1|2) the action pertains to

    Data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ScoreSnapshot = z.infer<typeof ScoreSnapshotSchema>;
