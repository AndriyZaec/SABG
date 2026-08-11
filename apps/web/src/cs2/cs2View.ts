import type { Answer, ArenaCancelledReason, ArenaPlayerStatus, RoundStatus } from "@arena/contracts";
import type { FeedItem, LeaderRow } from "../arena/arenaView.js";

// FeedItem/LeaderRow are discipline-agnostic value types (see arena/arenaView.ts) — reused as-is,
// not redefined, so the feed/leaderboard rail components (arena/live/{EliminationFeed,
// LeaderboardRail}.tsx) work unmodified for CS2 too.
export type { FeedItem, LeaderRow };

/** The current round as the CS2 arena screen needs it. Unlike soccer's RoundView, there is no
 *  `lockAt` — CS2 rounds have no fixed answer window (spec §6) — and no window minutes, only a
 *  round number (spec §2). */
export interface Cs2RoundView {
  roundId: string;
  roundNumber: number;
  question: string;
  status: RoundStatus;
  myAnswer?: Answer;
  correctAnswer?: Answer;
}

/** View model the CS2 arena screen renders from. No score/clock/period (CS2 has no soccer-style
 *  match state stream — Cs2ArenaRuntime never emits `match.state`). */
export interface Cs2ArenaView {
  homeTeam?: string;
  awayTeam?: string;
  seriesFormat?: number;
  survivors: number;
  totalPlayers: number;
  round?: Cs2RoundView;
  /** This player's own status — same semantics as soccer's ArenaView.myStatus. */
  myStatus?: ArenaPlayerStatus;
  /** Set once an `arena.cancelled` message arrives (spec §4 п.4 no-show, or the Arena #k+1
   *  forfeit-cancellation gap) — the arena never went live and never will. */
  cancelled?: { reason: ArenaCancelledReason };
  feed: FeedItem[];
  leaderboard: LeaderRow[];
}
