// B6 — Leaderboard Service's side-effecting edge: consumes B4 Settlement Engine output
// (`PlayerResultEvent` per active player, `SettlementEvent` once per round) to maintain a
// per-player score/status accumulator, and decides when the arena is finished (build plan §B6,
// spec §7). Persistence and the WS push (`leaderboard.update` / `arena.finished`) are deferred to
// B7 — this module only emits snapshots/winners through injected callbacks, same pattern as the
// other engines (see settlement/engine.ts).

import type { IsoDateTime, PredictionResult, Uuid, LeaderboardEntry } from "@arena/contracts";
import type { PlayerResultEvent, SettlementEvent } from "../settlement/engine.js";
import { rankLeaderboard, resolveWinners, type LeaderboardAccumulator } from "./rank.js";

export interface LeaderboardRosterEntry {
  userId: Uuid;
  username: string;
  joinedAt: IsoDateTime;
}

export interface LeaderboardServiceOptions {
  onSnapshot?: (entries: LeaderboardEntry[]) => void;
  onFinished?: (winners: Uuid[]) => void;
}

export class LeaderboardService {
  private readonly rows = new Map<Uuid, LeaderboardAccumulator>();
  /** Buffered per-round results, applied atomically once that round's SettlementEvent arrives. */
  private readonly pendingByRound = new Map<Uuid, PlayerResultEvent[]>();
  private finished = false;

  constructor(
    private readonly arenaId: Uuid,
    roster: LeaderboardRosterEntry[],
    private readonly options: LeaderboardServiceOptions = {},
  ) {
    for (const player of roster) {
      this.rows.set(player.userId, {
        userId: player.userId,
        username: player.username,
        status: "active",
        score: 0,
        missedCount: 0,
        joinedAt: player.joinedAt,
      });
    }
  }

  /** Buffers one player's outcome for a round; applied once that round's onRoundSettled fires. */
  onPlayerResult(event: PlayerResultEvent): void {
    let pending = this.pendingByRound.get(event.roundId);
    if (pending === undefined) {
      pending = [];
      this.pendingByRound.set(event.roundId, pending);
    }
    pending.push(event);
  }

  /**
   * Applies a round's buffered player results atomically, then runs early-finish detection
   * (spec §7 one-survivor / this arena's zero-survivor rule) against the active set before vs.
   * after this round.
   */
  onRoundSettled(event: SettlementEvent): void {
    const pending = this.pendingByRound.get(event.roundId);
    this.pendingByRound.delete(event.roundId);
    if (pending === undefined || this.finished) return;

    const activeBefore = this.activeRows();

    for (const result of pending) {
      const row = this.rows.get(result.userId);
      if (row === undefined) continue; // not on this arena's roster — ignore defensively
      this.applyResult(row, result.result);
    }

    this.options.onSnapshot?.(this.snapshot());

    const activeAfter = this.activeRows();
    if (activeAfter.length === 1) {
      this.finish(activeAfter);
    } else if (activeAfter.length === 0) {
      this.finish(activeBefore);
    }
  }

  /** Called by the orchestrator once the match reaches full time (spec §7 multi-survivor). */
  finalize(): void {
    if (this.finished) return;
    this.finish(this.activeRows());
  }

  /** Ranked, display-ready snapshot of every tracked player. */
  snapshot(): LeaderboardEntry[] {
    return rankLeaderboard([...this.rows.values()]);
  }

  private applyResult(row: LeaderboardAccumulator, result: PredictionResult): void {
    if (result === "correct") {
      row.score += 1;
      return;
    }
    if (result === "missed") row.missedCount += 1;
    row.status = "eliminated";
  }

  private activeRows(): LeaderboardAccumulator[] {
    return [...this.rows.values()].filter((row) => row.status === "active");
  }

  private finish(finalists: LeaderboardAccumulator[]): void {
    if (this.finished) return;
    this.finished = true;
    for (const row of finalists) row.status = "winner";
    this.options.onSnapshot?.(this.snapshot());
    this.options.onFinished?.(resolveWinners(finalists));
  }
}
