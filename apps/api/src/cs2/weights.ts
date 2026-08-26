// Provisional weights derived from 6 GRID series / 110 rounds — see docs/c2-migration-spec/question-weights.md.
// Keyed by team slot (0/1, raw GRID team-array order) rather than team identity — see that doc's
// "Data source" section for why the calibration itself is only meaningful per array position.
import type { Cs2Weapon } from "@arena/contracts";
import type { Cs2Candidate } from "./catalog.js";

export type Cs2DifficultyTier = "easy" | "medium" | "hard";
export type Cs2TeamSlot = 0 | 1;

const TEAM_ACE_DIFFICULTY: Readonly<Record<Cs2TeamSlot, number>> = { 0: 0.018, 1: 0.036 };

const MULTIKILL_DIFFICULTY: Readonly<Record<Cs2TeamSlot, Partial<Record<number, number>>>> = {
  0: { 2: 0.589, 3: 0.464, 4: 0.107, 5: 0.018 },
  1: { 2: 0.929, 3: 0.339, 4: 0.125, 5: 0.036 },
};

const SURVIVORS_ROUND_DIFFICULTY: Record<number, number> = {
  0: 0.036,
  1: 0.161,
  2: 0.679,
  3: 0.804,
  4: 0.321,
  5: 0.054,
};

const WEAPON_DIFFICULTY: Partial<Record<Cs2Weapon, number>> = {
  hegrenade: 0.071,
  molotov: 0.161,
  tec9: 0.161,
  deagle: 0.339,
  ak47: 0.5,
  awp: 0.839,
};

const PISTOL_CONDITIONAL_WEAPON_DIFFICULTY: Partial<Record<Cs2Weapon, { pistol: number; nonPistol: number }>> = {
  glock: { pistol: 0.286, nonPistol: 0.08 },
  usp_silencer: { pistol: 0.286, nonPistol: 0.14 },
};

const ECONOMY_BANNED_WEAPONS = new Set<Cs2Weapon>(["ak47", "awp", "molotov", "hegrenade"]);
const ECONOMY_BANNED_ROUNDS = new Set([1, 2, 13, 14]);

/** undefined marks a flat-pool topic (round_winner, survivors_team) — excluded from calibration. */
export function cs2Difficulty(candidate: Cs2Candidate, isPistolRound: boolean, teamSlot: Cs2TeamSlot | undefined): number | undefined {
  switch (candidate.topic) {
    case "team_ace":
      return teamSlot !== undefined ? TEAM_ACE_DIFFICULTY[teamSlot] : undefined;
    case "multikill":
      return teamSlot !== undefined && candidate.params.y !== undefined ? MULTIKILL_DIFFICULTY[teamSlot][candidate.params.y] : undefined;
    case "survivors_round":
      return candidate.params.y !== undefined ? SURVIVORS_ROUND_DIFFICULTY[candidate.params.y] : undefined;
    case "weapon_kill": {
      if (candidate.params.weapon === undefined) return undefined;
      const conditional = PISTOL_CONDITIONAL_WEAPON_DIFFICULTY[candidate.params.weapon];
      if (conditional !== undefined) return isPistolRound ? conditional.pistol : conditional.nonPistol;
      return WEAPON_DIFFICULTY[candidate.params.weapon];
    }
    default:
      return undefined;
  }
}

export function cs2TierForRound(roundNumber: number): Cs2DifficultyTier {
  if (roundNumber <= 5) return "easy";
  if (roundNumber <= 14) return "medium";
  return "hard";
}

export function isCs2PistolRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === 13;
}

export function isEconomyBanned(candidate: Cs2Candidate, roundNumber: number): boolean {
  if (candidate.topic !== "weapon_kill" || candidate.params.weapon === undefined) return false;
  return ECONOMY_BANNED_WEAPONS.has(candidate.params.weapon) && ECONOMY_BANNED_ROUNDS.has(roundNumber);
}

export function isPistolConditionalWeapon(weapon: Cs2Weapon): boolean {
  return weapon in PISTOL_CONDITIONAL_WEAPON_DIFFICULTY;
}

export function cs2TierMatches(tier: Cs2DifficultyTier, difficulty: number): boolean {
  if (tier === "easy") return difficulty < 0.2;
  if (tier === "medium") return difficulty >= 0.2 && difficulty < 0.5;
  return difficulty >= 0.5;
}
