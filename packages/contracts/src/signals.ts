import type { IsoDateTime } from "./entities.js";
import type { LiveEvent } from "./entities.js";
import type { MatchPeriod, TeamSide } from "./enums.js";
import type { Cs2GameSnapshot } from "./settlement.js";

export interface MatchSignalEvent {
  kind: "event";
  event: LiveEvent;
}

export interface MatchSignalClock {
  kind: "clock";
  period: MatchPeriod;
  matchMinute: number;
  running: boolean;
  timestamp: IsoDateTime;
}

export interface MatchSignalPossession {
  kind: "possession";
  team: TeamSide;
  timestamp: IsoDateTime;
}

export interface MatchSignalCs2Snapshot {
  kind: "cs2_snapshot";
  snapshot: Cs2GameSnapshot;
  timestamp: IsoDateTime;
}

export interface MatchSignalCs2RoundLock {
  kind: "cs2_round_lock";
  roundNumber: number;
  timestamp: IsoDateTime;
}

export interface MatchSignalCs2RoundEnd {
  kind: "cs2_round_end";
  roundNumber: number;
  snapshot: Cs2GameSnapshot;
  timestamp: IsoDateTime;
}

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
