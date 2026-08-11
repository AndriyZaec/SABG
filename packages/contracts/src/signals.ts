// Internal S3 event bus payload (build plan §S3), enriched beyond the settlement whitelist.
// `LiveEvent` alone (confirmed target events only) can't drive the Match State Engine (B2) —
// it needs period/minute/possession too, which the raw feed carries but the settlement
// whitelist deliberately drops. Ingestion (B1) is the only place that knows the raw TXODDS
// wire format; it maps that into this union so B2 stays a pure reducer over domain signals.

import type { IsoDateTime } from "./entities.js";
import type { LiveEvent } from "./entities.js";
import type { MatchPeriod, TeamSide } from "./enums.js";
import type { Cs2GameSnapshot } from "./settlement.js";

/** A confirmed, whitelisted settlement-target event (unchanged from the S3 LiveEvent stream). */
export interface MatchSignalEvent {
  kind: "event";
  event: LiveEvent;
}

/** Match clock/period changed (derived from StatusId + Clock.Seconds at the ingestion edge). */
export interface MatchSignalClock {
  kind: "clock";
  period: MatchPeriod;
  /** Match minute incl. stoppage. */
  matchMinute: number;
  running: boolean;
  timestamp: IsoDateTime;
}

/** Possession changed side (context-only per spec §4.1 — never a settlement target). */
export interface MatchSignalPossession {
  kind: "possession";
  team: TeamSide;
  timestamp: IsoDateTime;
}

/**
 * CS2 signal union (cs2-migration-spec/spec_v2.md §7 Round Engine Flow). Produced by the
 * CS2-specific ingestion edge (round-tracker over GRID `seriesState` polls) — deliberately
 * separate shapes from the soccer clock/event/possession union above, per spec §3 ("round engine
 * internals NOT unified between disciplines"). Every soccer engine already narrows on
 * `signal.kind`, so adding these variants is a no-op for the existing soccer pipeline.
 */

/** Every GRID poll, verbatim (parsed). Consumed by anything tracking live per-round state. */
export interface MatchSignalCs2Snapshot {
  kind: "cs2_snapshot";
  snapshot: Cs2GameSnapshot;
  timestamp: IsoDateTime;
}

/** Freezetime ended for `roundNumber` — the live clock started ticking down (spec §2 Round Lock). */
export interface MatchSignalCs2RoundLock {
  kind: "cs2_round_lock";
  roundNumber: number;
  timestamp: IsoDateTime;
}

/** `roundNumber` ended — a team's `teams[].score` increased (spec §7 п.7 "Переможець раунду"). */
export interface MatchSignalCs2RoundEnd {
  kind: "cs2_round_end";
  roundNumber: number;
  winner: TeamSide;
  snapshot: Cs2GameSnapshot;
  timestamp: IsoDateTime;
}

/** GRID's `hasLiveGame()` turned false for this Match's Game object (spec §4 step 2, §7 step 3). */
export interface MatchSignalCs2MatchEnd {
  kind: "cs2_match_end";
  timestamp: IsoDateTime;
}

export type Cs2MatchSignal =
  | MatchSignalCs2Snapshot
  | MatchSignalCs2RoundLock
  | MatchSignalCs2RoundEnd
  | MatchSignalCs2MatchEnd;

export type MatchSignal = MatchSignalEvent | MatchSignalClock | MatchSignalPossession | Cs2MatchSignal;
