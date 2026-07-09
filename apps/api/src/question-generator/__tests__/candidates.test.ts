import { describe, expect, it } from "vitest";
import { TARGET_EVENT_TYPES } from "@arena/contracts";
import { pickCandidate } from "../candidates.js";

const NO_SUBS = { home: 0, away: 0 };

describe("pickCandidate", () => {
  it("picks deterministically from the full 21-candidate pool when there's no history", () => {
    const pick = pickCandidate({ windowStartMinute: 0, substitutionCounts: NO_SUBS, previousTargetEventType: undefined });
    expect(pick).toEqual({ targetEventType: "shot", targetTeam: "home" });
  });

  it("is deterministic: identical inputs always produce the identical pick", () => {
    const input = { windowStartMinute: 37, substitutionCounts: { home: 2, away: 1 }, previousTargetEventType: "corner" as const };
    expect(pickCandidate(input)).toEqual(pickCandidate({ ...input }));
  });

  it("varies the target type across windows instead of always picking the same one", () => {
    const picks = Array.from({ length: 18 }, (_, i) =>
      pickCandidate({ windowStartMinute: i * 5, substitutionCounts: NO_SUBS, previousTargetEventType: undefined }),
    );
    const distinctTypes = new Set(picks.map((p) => p.targetEventType));
    expect(distinctTypes.size).toBeGreaterThan(1);
  });

  it("never picks every whitelisted target type as unreachable — sweeping windowStartMinute covers variety", () => {
    const picks = Array.from({ length: 100 }, (_, i) =>
      pickCandidate({ windowStartMinute: i, substitutionCounts: NO_SUBS, previousTargetEventType: undefined }),
    );
    const distinctTypes = new Set(picks.map((p) => p.targetEventType));
    expect(distinctTypes.size).toBe(TARGET_EVENT_TYPES.length);
  });

  it("never picks a specific team's substitution once that team is at the substitution cap", () => {
    const picks = Array.from({ length: 50 }, (_, i) =>
      pickCandidate({ windowStartMinute: i, substitutionCounts: { home: 5, away: 0 }, previousTargetEventType: undefined }),
    );
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam === "home")).toBe(false);
    // The cap is per-team — away substitutions (and "any") must still be reachable.
    expect(picks.some((p) => p.targetEventType === "substitution" && p.targetTeam !== "home")).toBe(true);
  });

  it("excludes the previous round's target type for variety", () => {
    const picks = Array.from({ length: 50 }, (_, i) =>
      pickCandidate({ windowStartMinute: i, substitutionCounts: NO_SUBS, previousTargetEventType: "shot" }),
    );
    expect(picks.every((p) => p.targetEventType !== "shot")).toBe(true);
  });

  it("stays well-defined under extreme substitution counts and any previousTargetEventType (never throws, always returns a valid candidate)", () => {
    for (const previousTargetEventType of [...TARGET_EVENT_TYPES, undefined]) {
      for (const windowStartMinute of [0, 5, 45, 85]) {
        const pick = pickCandidate({
          windowStartMinute,
          substitutionCounts: { home: 999, away: 999 },
          previousTargetEventType,
        });
        expect(TARGET_EVENT_TYPES).toContain(pick.targetEventType);
        expect(["home", "away", "any"]).toContain(pick.targetTeam);
      }
    }
  });
});
