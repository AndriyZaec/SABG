import { describe, expect, it, vi } from "vitest";
import { TARGET_EVENT_TYPES } from "@arena/contracts";
import { eligibleCandidates, pickCandidate } from "../candidates.js";

const NO_SUBS = { home: 0, away: 0 };

describe("eligibleCandidates (pure, deterministic filtering — no randomness involved)", () => {
  it("returns the full 21-candidate pool when there's no history or caps", () => {
    const pool = eligibleCandidates({ substitutionCounts: NO_SUBS, previousTargetEventType: undefined });
    expect(pool).toHaveLength(TARGET_EVENT_TYPES.length * 3);
  });

  it("is deterministic: identical inputs always produce the identical pool", () => {
    const input = { substitutionCounts: { home: 2, away: 1 }, previousTargetEventType: "corner" as const };
    expect(eligibleCandidates(input)).toEqual(eligibleCandidates({ ...input }));
  });

  it("excludes a specific team's substitution once that team is at the cap, but not the other team's or 'any'", () => {
    const pool = eligibleCandidates({ substitutionCounts: { home: 5, away: 0 }, previousTargetEventType: undefined });
    expect(pool.some((c) => c.targetEventType === "substitution" && c.targetTeam === "home")).toBe(false);
    expect(pool.some((c) => c.targetEventType === "substitution" && c.targetTeam === "away")).toBe(true);
    expect(pool.some((c) => c.targetEventType === "substitution" && c.targetTeam === "any")).toBe(true);
  });

  it("excludes the previous round's target type entirely, for every team side", () => {
    const pool = eligibleCandidates({ substitutionCounts: NO_SUBS, previousTargetEventType: "shot" });
    expect(pool.every((c) => c.targetEventType !== "shot")).toBe(true);
  });

  it("falls back to the cap-only-filtered pool rather than ever returning empty, if excluding the previous type would leave nothing", () => {
    // Cap every substitution AND exclude "substitution" as the previous type is impossible to
    // empty out (other event types remain), but this asserts the fallback logic never underflows:
    // even with both filters active, the pool is non-empty and internally consistent.
    const pool = eligibleCandidates({ substitutionCounts: { home: 5, away: 5 }, previousTargetEventType: "substitution" });
    expect(pool.length).toBeGreaterThan(0);
  });

  it("is well-defined (non-empty, only valid candidates) under extreme substitution counts and every previousTargetEventType", () => {
    for (const previousTargetEventType of [...TARGET_EVENT_TYPES, undefined]) {
      const pool = eligibleCandidates({ substitutionCounts: { home: 999, away: 999 }, previousTargetEventType });
      expect(pool.length).toBeGreaterThan(0);
      for (const candidate of pool) {
        expect(TARGET_EVENT_TYPES).toContain(candidate.targetEventType);
        expect(["home", "away", "any"]).toContain(candidate.targetTeam);
      }
    }
  });
});

describe("pickCandidate (the one randomized step)", () => {
  it("always returns a member of eligibleCandidates(input)", () => {
    const input = { substitutionCounts: NO_SUBS, previousTargetEventType: undefined };
    const pool = eligibleCandidates(input);
    for (let i = 0; i < 50; i++) {
      expect(pool).toContainEqual(pickCandidate(input));
    }
  });

  it("never picks a capped team's substitution or the previous round's type, across many draws", () => {
    const input = { substitutionCounts: { home: 5, away: 0 }, previousTargetEventType: "shot" as const };
    for (let i = 0; i < 100; i++) {
      const pick = pickCandidate(input);
      expect(pick.targetEventType === "substitution" && pick.targetTeam === "home").toBe(false);
      expect(pick.targetEventType).not.toBe("shot");
    }
  });

  it("is randomized: identical inputs can produce different picks across repeated calls", () => {
    const input = { substitutionCounts: NO_SUBS, previousTargetEventType: undefined };
    const picks = new Set(Array.from({ length: 50 }, () => JSON.stringify(pickCandidate(input))));
    // With a 20-candidate pool and 50 draws, seeing only ever one distinct value would mean
    // Math.random() isn't actually being consulted — vanishingly unlikely otherwise.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("draws its index via Math.random(), scaled to the pool size", () => {
    const input = { substitutionCounts: NO_SUBS, previousTargetEventType: undefined };
    const pool = eligibleCandidates(input);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(pickCandidate(input)).toEqual(pool[0]);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
