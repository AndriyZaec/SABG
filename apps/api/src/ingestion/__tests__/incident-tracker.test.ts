import { describe, expect, it } from "vitest";
import { createLiveEventProcessor } from "../incident-tracker.js";
import type { ScoreSnapshot } from "../score-snapshot.js";

const MATCH_ID = "00000000-0000-0000-0000-000000000001";

function snapshot(overrides: Partial<ScoreSnapshot>): ScoreSnapshot {
  return {
    FixtureId: 1,
    StatusId: 2,
    Clock: { Seconds: 600 },
    Participant1IsHome: true,
    ...overrides,
  };
}

describe("createLiveEventProcessor", () => {
  it("does not emit a provisional (Confirmed:false) message", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    const result = processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: false }));
    expect(result).toBeNull();
  });

  it("emits once when the same incident Id is later confirmed", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    expect(processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: false }))).toBeNull();

    const confirmed = processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: true }));
    expect(confirmed).not.toBeNull();
    expect(confirmed?.eventType).toBe("goal");
  });

  it("dedupes a second Confirmed:true message for the same incident Id", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: false }));
    const first = processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: true }));
    const second = processor.process(snapshot({ Action: "goal", Id: 1, Confirmed: true }));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("drops a pending incident on action_discarded, emitting nothing for it", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    processor.process(snapshot({ Action: "corner", Id: 5, Confirmed: false }));
    const discarded = processor.process(snapshot({ Action: "action_discarded", Id: 5 }));
    expect(discarded).toBeNull();
  });

  it("still emits if the same Id is later (re-)confirmed after a discard — deliberately minimal", () => {
    // action_discarded only clears *pending* state; it doesn't block future confirmations of
    // the same Id. Locking this in so a later, more careful discard-handling change is
    // deliberate rather than an accidental behavior shift.
    const processor = createLiveEventProcessor(MATCH_ID);
    processor.process(snapshot({ Action: "corner", Id: 5, Confirmed: false }));
    processor.process(snapshot({ Action: "action_discarded", Id: 5 }));
    const lateConfirm = processor.process(snapshot({ Action: "corner", Id: 5, Confirmed: true }));
    expect(lateConfirm).not.toBeNull();
  });

  it("treats each distinct incident Id independently", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    processor.process(snapshot({ Action: "shot", Id: 10, Confirmed: false }));
    processor.process(snapshot({ Action: "shot", Id: 11, Confirmed: false }));

    const first = processor.process(snapshot({ Action: "shot", Id: 10, Confirmed: true }));
    const second = processor.process(snapshot({ Action: "shot", Id: 11, Confirmed: true }));

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  it("falls back to emitting only confirmed messages when there's no Id to correlate", () => {
    const processor = createLiveEventProcessor(MATCH_ID);
    expect(processor.process(snapshot({ Action: "goal", Confirmed: false }))).toBeNull();
    expect(processor.process(snapshot({ Action: "goal", Confirmed: true }))).not.toBeNull();
  });
});
