import { describe, expect, it } from "vitest";
import { deriveMinute, normalizeEvent, participantToSide } from "../normalize.js";
import type { ScoreSnapshot } from "../score-snapshot.js";

const MATCH_ID = "00000000-0000-0000-0000-000000000001";

function snapshot(overrides: Partial<ScoreSnapshot>): ScoreSnapshot {
  return {
    FixtureId: 1,
    Ts: 1_700_000_000_000,
    Participant1IsHome: true,
    ...overrides,
  };
}

describe("deriveMinute", () => {
  it("derives the minute from elapsed clock seconds in the first half", () => {
    // Clock.Seconds is elapsed seconds since kickoff (verified against fixture 18179764's
    // H1/H2 boundary) -> floor(2000/60) = 33' (match clock reads 33:20)
    expect(deriveMinute(2, 2000)).toBe(33);
  });

  it("keeps counting across the H1/H2 boundary without a per-period reset", () => {
    // H2 (StatusId 4) continues the same accumulating clock past 45:00 (2700s)
    expect(deriveMinute(4, 2760)).toBe(46);
  });

  it("does not roll a corner at clock 14:01-15:00 into the 15' window (regression)", () => {
    // clockSeconds 841-900 is match clock 14:01-15:00 -> minute 14, not 15, so it must not
    // satisfy a SettlementCondition with windowStartMinute: 15.
    expect(deriveMinute(2, 841)).toBe(14);
    expect(deriveMinute(2, 900)).toBe(15);
  });

  it("returns undefined for non-clocked phases (e.g. half time, not started)", () => {
    expect(deriveMinute(3, 100)).toBeUndefined();
    expect(deriveMinute(1, 100)).toBeUndefined();
  });

  it("returns undefined when statusId or clock seconds are missing", () => {
    expect(deriveMinute(undefined, 100)).toBeUndefined();
    expect(deriveMinute(2, undefined)).toBeUndefined();
  });
});

describe("participantToSide", () => {
  it("maps participant 1 to home when Participant1IsHome is true", () => {
    expect(participantToSide(1, true)).toBe("home");
    expect(participantToSide(2, true)).toBe("away");
  });

  it("flips mapping when Participant1IsHome is false", () => {
    expect(participantToSide(1, false)).toBe("away");
    expect(participantToSide(2, false)).toBe("home");
  });

  it("returns undefined for a non-1|2 participant", () => {
    expect(participantToSide(undefined, true)).toBeUndefined();
    expect(participantToSide(3, true)).toBeUndefined();
  });
});

describe("normalizeEvent", () => {
  it("maps a whitelisted action to its LiveEvent eventType", () => {
    const event = normalizeEvent(
      MATCH_ID,
      snapshot({ Action: "goal", StatusId: 2, Clock: { Seconds: 2000 }, Participant: 1 }),
    );
    expect(event).not.toBeNull();
    expect(event?.eventType).toBe("goal");
    expect(event?.matchMinute).toBe(33);
    expect(event?.team).toBe("home");
    expect(event?.matchId).toBe(MATCH_ID);
  });

  it("maps all card variants to the 'card' target type", () => {
    for (const action of ["yellow_card", "second_yellow_card", "red_card"]) {
      const event = normalizeEvent(
        MATCH_ID,
        snapshot({ Action: action, StatusId: 2, Clock: { Seconds: 2000 } }),
      );
      expect(event?.eventType).toBe("card");
    }
  });

  it("drops free_kick — deliberately excluded, occurs too often to be a valid target", () => {
    const event = normalizeEvent(
      MATCH_ID,
      snapshot({ Action: "free_kick", StatusId: 2, Clock: { Seconds: 2000 } }),
    );
    expect(event).toBeNull();
  });

  it("drops non-whitelisted actions (possession, throw_in, jersey, ...)", () => {
    for (const action of ["possession", "throw_in", "goal_kick", "jersey", "comment", "status"]) {
      const event = normalizeEvent(
        MATCH_ID,
        snapshot({ Action: action, StatusId: 2, Clock: { Seconds: 2000 } }),
      );
      expect(event).toBeNull();
    }
  });

  it("drops whitelisted actions whose minute can't be derived (e.g. half time)", () => {
    const event = normalizeEvent(MATCH_ID, snapshot({ Action: "shot", StatusId: 3, Clock: { Seconds: 0 } }));
    expect(event).toBeNull();
  });

  it("maps Confirmed true/false/absent to the confirmed flag", () => {
    const base = { Action: "shot", StatusId: 2, Clock: { Seconds: 2000 } };
    expect(normalizeEvent(MATCH_ID, snapshot({ ...base, Confirmed: true }))?.confirmed).toBe(true);
    expect(normalizeEvent(MATCH_ID, snapshot({ ...base, Confirmed: false }))?.confirmed).toBe(false);
    expect(normalizeEvent(MATCH_ID, snapshot(base))?.confirmed).toBe(false);
  });

  it("emits team 'any' for a neutral action with no participant", () => {
    const event = normalizeEvent(
      MATCH_ID,
      snapshot({ Action: "goal", StatusId: 2, Clock: { Seconds: 2000 }, Participant: undefined }),
    );
    expect(event?.team).toBe("any");
  });
});
