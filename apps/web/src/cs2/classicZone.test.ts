import { describe, expect, it } from "vitest";
import type { Cs2ArenaView, Cs2RoundView } from "./cs2View.js";
import { classicRoundScoring, classicZoneHud } from "./classicZone.js";

type HudInput = Parameters<typeof classicZoneHud>[0];

function round(roundNumber: number, status: Cs2RoundView["status"]): Cs2RoundView {
  return { roundId: `r${roundNumber}`, roundNumber, question: "?", status };
}

function view(overrides: Partial<HudInput> = {}): HudInput {
  return { mode: "classic", stage: "zone", ...overrides };
}

describe("classicZoneHud", () => {
  it("shows no zone before the first round", () => {
    expect(classicZoneHud(view())).toEqual({ stage: "zone", zoneNow: 0, nextZone: 0 });
  });

  it("reads the zone after the open round from the schedule", () => {
    // R6 and R7 add 1 each, R8 adds 2.
    expect(classicZoneHud(view({ round: round(8, "open") }))).toMatchObject({ zoneNow: 2, nextZone: 4 });
    expect(classicZoneHud(view({ round: round(8, "locked") }))).toMatchObject({ zoneNow: 2, nextZone: 4 });
  });

  it("moves on to the next round once the current one settles", () => {
    expect(classicZoneHud(view({ round: round(8, "settled") }))).toMatchObject({ zoneNow: 4, nextZone: 5 });
  });

  it("hides the zone numbers in Final Circle", () => {
    expect(classicZoneHud(view({ stage: "final_circle", round: round(20, "open") })))
      .toEqual({ stage: "final_circle" });
  });

  it("shows nothing for hardcore or a finished arena", () => {
    expect(classicZoneHud(view({ mode: "hardcore" }))).toBeUndefined();
    expect(classicZoneHud(view({ finished: true }))).toBeUndefined();
  });
});

describe("classicRoundScoring", () => {
  const classic: Pick<Cs2ArenaView, "mode" | "stage"> = { mode: "classic", stage: "zone" };

  it("marks double rounds while the zone is in play", () => {
    expect([1, 2, 11, 12, 13, 24, 25].map((n) => classicRoundScoring(classic, n)?.double))
      .toEqual([true, false, false, true, true, true, false]);
  });

  it("falls back to elimination scoring in hardcore and Final Circle", () => {
    expect(classicRoundScoring({ mode: "hardcore", stage: "zone" }, 1)).toBeUndefined();
    expect(classicRoundScoring({ mode: "classic", stage: "final_circle" }, 24)).toBeUndefined();
  });
});
