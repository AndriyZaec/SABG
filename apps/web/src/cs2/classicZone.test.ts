import { describe, expect, it } from "vitest";
import type { ArenaZoneMessage } from "@arena/contracts";
import { classicRoundScoring, classicZoneHud } from "./classicZone.js";

type HudInput = Parameters<typeof classicZoneHud>[0];

const DEFAULT_ZONE: ArenaZoneMessage = { type: "arena.zone", stage: "zone", zone: 0, nextZone: 0 };
const FINAL_CIRCLE: ArenaZoneMessage = { type: "arena.zone", stage: "final_circle", fromRound: 18 };

function view(overrides: Partial<HudInput> = {}): HudInput {
  return { mode: "classic", zone: DEFAULT_ZONE, ...overrides };
}

describe("classicZoneHud", () => {
  it("shows zone 0 / next 0 before the server sends a zone", () => {
    expect(classicZoneHud(view())).toEqual({ stage: "zone", zoneNow: 0, nextZone: 0 });
  });

  it("shows the server's numbers as they are", () => {
    // Live run: R9 settled with zone 5 while R10 was still locked and R11 open.
    const zone: ArenaZoneMessage = { type: "arena.zone", stage: "zone", zone: 5, nextZone: 6 };
    expect(classicZoneHud(view({ zone }))).toEqual({ stage: "zone", zoneNow: 5, nextZone: 6 });
  });

  it("hides the zone numbers in Final Circle", () => {
    expect(classicZoneHud(view({ zone: FINAL_CIRCLE }))).toEqual({ stage: "final_circle" });
  });

  it("shows nothing for hardcore or a finished arena", () => {
    expect(classicZoneHud(view({ mode: "hardcore" }))).toBeUndefined();
    expect(classicZoneHud(view({ finished: true }))).toBeUndefined();
  });
});

describe("classicRoundScoring", () => {
  it("marks double rounds while the zone is in play", () => {
    expect([1, 2, 11, 12, 13, 24, 25].map((n) => classicRoundScoring(view(), n)?.double))
      .toEqual([true, false, false, true, true, true, false]);
  });

  it("falls back to elimination scoring in hardcore and Final Circle", () => {
    expect(classicRoundScoring(view({ mode: "hardcore" }), 1)).toBeUndefined();
    expect(classicRoundScoring(view({ zone: FINAL_CIRCLE }), 24)).toBeUndefined();
  });
});
