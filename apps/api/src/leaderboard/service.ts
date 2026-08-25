import type { IsoDateTime, PredictionResult, Uuid, LeaderboardEntry } from "@arena/contracts";
import type { PlayerResultEvent } from "../settlement/engine.js";
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
  // Apply every player's result atomically at the round boundary.
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

  addPlayer(player: LeaderboardRosterEntry): void {
    if (this.finished || this.rows.has(player.userId)) return;
    this.rows.set(player.userId, {
      userId: player.userId,
      username: player.username,
      status: "active",
      score: 0,
      missedCount: 0,
      joinedAt: player.joinedAt,
    });
  }

  onPlayerResult(event: PlayerResultEvent): void {
    let pending = this.pendingByRound.get(event.roundId);
    if (pending === undefined) {
      pending = [];
      this.pendingByRound.set(event.roundId, pending);
    }
    pending.push(event);
  }

  onRoundSettled(event: { roundId: Uuid }): void {
    const pending = this.pendingByRound.get(event.roundId);
    this.pendingByRound.delete(event.roundId);
    if (pending === undefined || this.finished) return;

    const activeBefore = this.activeRows();

    for (const result of pending) {
      const row = this.rows.get(result.userId);
      if (row === undefined) continue;
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

  finalize(): void {
    if (this.finished) return;
    this.finish(this.activeRows());
  }

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
