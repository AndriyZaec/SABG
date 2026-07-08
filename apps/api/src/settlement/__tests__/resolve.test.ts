import { describe, expect, it } from "vitest";
import type { SettleableEvent, SettlementCondition } from "@arena/contracts";
import { resolveSettlement } from "../resolve.js";

const CONDITION: SettlementCondition = {
  targetEventType: "shot",
  targetTeam: "home",
  windowStartMinute: 20,
  windowEndMinute: 25,
  resolve: "event_in_window",
};

function event(overrides: Partial<SettleableEvent> = {}): SettleableEvent {
  return { eventType: "shot", team: "home", matchMinute: 22, confirmed: true, ...overrides };
}

describe("resolveSettlement", () => {
  it("resolves yes when a confirmed matching event falls inside the window", () => {
    expect(resolveSettlement(CONDITION, [event()])).toBe("yes");
  });

  it("resolves no when there is no matching event", () => {
    expect(resolveSettlement(CONDITION, [])).toBe("no");
  });

  it("resolves no when the event type doesn't match", () => {
    expect(resolveSettlement(CONDITION, [event({ eventType: "corner" })])).toBe("no");
  });

  it("resolves no when the event falls outside [windowStartMinute, windowEndMinute]", () => {
    expect(resolveSettlement(CONDITION, [event({ matchMinute: 19 })])).toBe("no");
    expect(resolveSettlement(CONDITION, [event({ matchMinute: 26 })])).toBe("no");
  });

  it("treats window bounds as inclusive", () => {
    expect(resolveSettlement(CONDITION, [event({ matchMinute: 20 })])).toBe("yes");
    expect(resolveSettlement(CONDITION, [event({ matchMinute: 25 })])).toBe("yes");
  });

  it("resolves no for an unconfirmed (provisional) matching event", () => {
    expect(resolveSettlement(CONDITION, [event({ confirmed: false })])).toBe("no");
  });

  it("resolves no when the event is the wrong team for a team-specific condition", () => {
    expect(resolveSettlement(CONDITION, [event({ team: "away" })])).toBe("no");
  });

  it("matches either team when targetTeam is 'any'", () => {
    const anyCondition: SettlementCondition = { ...CONDITION, targetTeam: "any" };
    expect(resolveSettlement(anyCondition, [event({ team: "home" })])).toBe("yes");
    expect(resolveSettlement(anyCondition, [event({ team: "away" })])).toBe("yes");
  });

  it("resolves yes if any one event in a mixed list matches", () => {
    const events = [event({ eventType: "corner" }), event({ matchMinute: 5 }), event({ matchMinute: 22 })];
    expect(resolveSettlement(CONDITION, events)).toBe("yes");
  });
});
