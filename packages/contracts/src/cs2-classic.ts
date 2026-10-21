/** `final_circle` starts when the zone would eliminate every remaining player; from then on hardcore rules apply. */
export const ARENA_STAGES = ["zone", "final_circle"] as const;
export type ArenaStage = (typeof ARENA_STAGES)[number];

// Zone increments for rounds 6..24; rounds 1-5 add nothing, every overtime round adds 1.
const ZONE_INCREMENTS_R6_TO_R24 = [1, 1, 2, 1, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2] as const;
const GRACE_ROUNDS = 5;
const REGULATION_ROUNDS = 24;
const ZONE_AFTER_REGULATION = ZONE_INCREMENTS_R6_TO_R24.reduce<number>((sum, inc) => sum + inc, 0);

const DOUBLE_ROUNDS: ReadonlySet<number> = new Set([1, 12, 13, 24]);

/** Classic zone after round `roundNumber` settles: players with fewer points are eliminated. */
export function cs2ClassicZoneAfter(roundNumber: number): number {
  if (roundNumber > REGULATION_ROUNDS) return ZONE_AFTER_REGULATION + (roundNumber - REGULATION_ROUNDS);
  let zone = 0;
  for (let round = GRACE_ROUNDS + 1; round <= roundNumber; round++) {
    zone += ZONE_INCREMENTS_R6_TO_R24[round - GRACE_ROUNDS - 1]!;
  }
  return zone;
}

/** Classic double rounds open and close each half; none in overtime. */
export function isCs2ClassicDoubleRound(roundNumber: number): boolean {
  return DOUBLE_ROUNDS.has(roundNumber);
}

/** Points a correct answer earns in a classic arena. */
export function cs2ClassicRoundPoints(roundNumber: number): 1 | 2 {
  return isCs2ClassicDoubleRound(roundNumber) ? 2 : 1;
}
