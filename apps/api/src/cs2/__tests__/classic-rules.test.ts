import { describe, expect, it } from "vitest";
import { cs2ClassicRoundPoints, cs2ClassicZoneAfter, isCs2ClassicDoubleRound } from "@arena/contracts";

describe("cs2ClassicZoneAfter", () => {
  it("follows the classic schedule through regulation and overtime", () => {
    const expected: Record<number, number> = {
      1: 0, 4: 0, 5: 1, 6: 2, 7: 3, 8: 5, 12: 10, 13: 10, 16: 14, 17: 15, 20: 19, 21: 20, 24: 24, 25: 25, 30: 30,
    };
    for (const [round, zone] of Object.entries(expected)) {
      expect(cs2ClassicZoneAfter(Number(round)), `round ${round}`).toBe(zone);
    }
  });

  it("never decreases from round 1 to 40", () => {
    for (let round = 2; round <= 40; round++) {
      expect(cs2ClassicZoneAfter(round)).toBeGreaterThanOrEqual(cs2ClassicZoneAfter(round - 1));
    }
  });
});

describe("isCs2ClassicDoubleRound / cs2ClassicRoundPoints", () => {
  it("doubles exactly the pistol rounds 1 and 13", () => {
    const doubles: number[] = [];
    for (let round = 1; round <= 40; round++) {
      if (isCs2ClassicDoubleRound(round)) doubles.push(round);
      expect(cs2ClassicRoundPoints(round)).toBe(isCs2ClassicDoubleRound(round) ? 2 : 1);
    }
    expect(doubles).toEqual([1, 13]);
  });
});
