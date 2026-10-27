// Cross-arena player leaderboard: pure ranking over stored arena results. No I/O — `recompute.ts`
// loads the inputs and stores the ranked rows.

import type { Uuid } from "@arena/contracts";

export interface PlayerArenaResult {
  userId: Uuid;
  score: number;
  rank: number;
  won: boolean;
  roundsPlayed: number;
}

export interface PlayerRanking {
  userId: Uuid;
  rank: number;
  points: number;
  arenasPlayed: number;
  wins: number;
  secondPlaces: number;
  roundsPlayed: number;
  totalScore: number;
  totalPayoutLamports: number;
}

type Totals = Omit<PlayerRanking, "rank">;

/**
 * Points are the total arena score. Ties go to more wins, then more 2nd places, then more rounds
 * played, then fewer arenas; a rank is shared only when all of them are equal (the next rank skips).
 */
function compare(a: Totals, b: Totals): number {
  return (
    b.points - a.points ||
    b.wins - a.wins ||
    b.secondPlaces - a.secondPlaces ||
    b.roundsPlayed - a.roundsPlayed ||
    a.arenasPlayed - b.arenasPlayed
  );
}

export function rankPlayers(results: readonly PlayerArenaResult[], payouts: ReadonlyMap<Uuid, number>): PlayerRanking[] {
  const totals = new Map<Uuid, Totals>();
  for (const result of results) {
    const row = totals.get(result.userId) ?? {
      userId: result.userId,
      points: 0,
      arenasPlayed: 0,
      wins: 0,
      secondPlaces: 0,
      roundsPlayed: 0,
      totalScore: 0,
      totalPayoutLamports: payouts.get(result.userId) ?? 0,
    };
    row.points += result.score;
    row.totalScore += result.score;
    row.arenasPlayed += 1;
    if (result.won) row.wins += 1;
    if (result.rank === 2) row.secondPlaces += 1;
    row.roundsPlayed += result.roundsPlayed;
    totals.set(result.userId, row);
  }

  // userId only makes the order of full ties stable between runs; it never changes a rank.
  const sorted = [...totals.values()].sort((a, b) => compare(a, b) || a.userId.localeCompare(b.userId));
  let rank = 0;
  return sorted.map((row, index) => {
    const prev = sorted[index - 1];
    if (prev === undefined || compare(prev, row) !== 0) rank = index + 1;
    return { ...row, rank };
  });
}
