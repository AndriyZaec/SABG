// Internal S3 event bus payload (build plan §S3), enriched beyond the settlement whitelist.
// `LiveEvent` alone (confirmed target events only) can't drive the Match State Engine (B2) —
// it needs period/minute/possession too, which the raw feed carries but the settlement
// whitelist deliberately drops. Ingestion (B1) is the only place that knows the raw TXODDS
// wire format; it maps that into this union so B2 stays a pure reducer over domain signals.

import type { IsoDateTime } from "./entities.js";
import type { LiveEvent } from "./entities.js";
import type { MatchPeriod, TeamSide } from "./enums.js";

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

export type MatchSignal = MatchSignalEvent | MatchSignalClock | MatchSignalPossession;
