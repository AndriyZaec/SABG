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
  /** Ranked only virtually: it never pushes a real player down or takes a prize place. */
  disqualified: boolean;
}

type Totals = Omit<PlayerRanking, "rank" | "disqualified">;

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

/**
 * Real players are ranked among themselves. A disqualified player gets a virtual rank: the one a real
 * player with the same totals would have, so it may equal a real player's rank. Rows come in the board
 * order: by rank, a disqualified row before the real one sharing its rank, then by userId.
 */
export function rankPlayers(
  results: readonly PlayerArenaResult[],
  payouts: ReadonlyMap<Uuid, number>,
  disqualified: ReadonlySet<Uuid> = new Set(),
): PlayerRanking[] {
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
  let realCount = 0;
  let lastReal: (Totals & { rank: number }) | undefined;
  const ranked = sorted.map((row): PlayerRanking => {
    const tiesLastReal = lastReal !== undefined && compare(lastReal, row) === 0;
    const rank = tiesLastReal ? lastReal!.rank : realCount + 1;
    if (disqualified.has(row.userId)) return { ...row, rank, disqualified: true };
    realCount += 1;
    lastReal = { ...row, rank };
    return { ...row, rank, disqualified: false };
  });
  return ranked.sort(compareBoardOrder);
}

/** The board order every reader uses: rank, then a disqualified row before a real one, then userId. */
export function compareBoardOrder(a: Pick<PlayerRanking, "rank" | "disqualified" | "userId">, b: Pick<PlayerRanking, "rank" | "disqualified" | "userId">): number {
  return a.rank - b.rank || Number(b.disqualified) - Number(a.disqualified) || a.userId.localeCompare(b.userId);
}

/**
 * Prize places go by position, not rank: in board order, the N-th entry that is not disqualified gets
 * place N when that place has a prize. A full tie therefore spreads over consecutive places.
 */
export function assignPrizePlaces(
  entries: readonly Pick<PlayerRanking, "userId" | "disqualified">[],
  prizePlaces: readonly number[],
): Map<Uuid, number> {
  const places = new Set(prizePlaces);
  const assigned = new Map<Uuid, number>();
  let position = 0;
  for (const entry of entries) {
    if (entry.disqualified) continue;
    position += 1;
    if (places.has(position)) assigned.set(entry.userId, position);
  }
  return assigned;
}
