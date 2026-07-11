// Wraps the incident-tracker (settlement events, unchanged) and additionally derives
// clock/period and possession signals from the same raw feed message, so the Match State Engine
// never has to see the raw TXODDS wire format (CLAUDE.md: isolate raw feed at the edges). Emits
// change-only signals — the feed sends several messages per second, most of which don't move
// period/minute/possession, so no-ops are dropped rather than flooding the bus.

import type { MatchPeriod, MatchSignal, TeamSide } from "@arena/contracts";
import { deriveMinute, participantToSide } from "./normalize.js";
import { periodForStatus, type ScoreSnapshot } from "./score-snapshot.js";
import { createLiveEventProcessor } from "./incident-tracker.js";

export interface MatchSignalProducer {
  /** Feed one raw message through; returns zero or more signals to publish, in order. */
  process(raw: ScoreSnapshot): MatchSignal[];
}

export function createMatchSignalProducer(matchId: string): MatchSignalProducer {
  const eventProcessor = createLiveEventProcessor(matchId);

  let lastPeriod: MatchPeriod | undefined;
  let lastMinute = 0;
  let lastRunning = false;
  let lastPossession: TeamSide | undefined;
  /**
   * Monotonic floor for the derived minute, valid only within the current clocked segment
   * (first_half or second_half) — `undefined` means "no floor established yet in this segment".
   * Cleared, not zeroed, on every period change: see below for why.
   */
  let periodMinuteFloor: number | undefined;

  return {
    process(raw: ScoreSnapshot): MatchSignal[] {
      const signals: MatchSignal[] = [];
      const timestamp = raw.Ts !== undefined ? new Date(raw.Ts).toISOString() : new Date().toISOString();

      // `action_amend`/`action_discarded` amend or retract a *previously reported* incident —
      // the `StatusId`/`Clock` they carry can be stale (observed in fixture 18179764: an
      // action_amend for a first-half shot arrives during halftime carrying StatusId=2,
      // sandwiched between two halftime `status` messages). Never derive clock/period/
      // possession from them.
      const isAmendOrDiscard = raw.Action === "action_amend" || raw.Action === "action_discarded";

      const period = isAmendOrDiscard ? undefined : periodForStatus(raw.StatusId);
      if (period !== undefined) {
        // Clear the floor across every period change — a genuinely new clocked segment (e.g.
        // second_half) must NOT be clamped against the previous segment's high-water mark. The
        // feed resets its own Clock.Seconds at the H1/H2 boundary via a `clock_adjustment`
        // message (confirmed in fixture 18179764: seconds snap to exactly 2700 = 45:00, then H2
        // counts up from there) — so the first derived minute of a new segment is already
        // correct on its own and needs no adjustment from us.
        if (period !== lastPeriod) periodMinuteFloor = undefined;

        const derived = deriveMinute(raw.StatusId, raw.Clock?.Seconds);
        let matchMinute: number;
        if (derived !== undefined) {
          // Within a segment, never regress: a confirmed incident (e.g. a goal) can arrive after
          // later messages already ticked the clock forward, but still carry the *older*
          // Clock.Seconds recorded at the moment the incident happened (observed in fixture
          // 18179764: a delayed goal confirm at minute 7 arrives after intervening messages
          // already reported minute 8). Clamp forward only once a floor exists for this segment.
          matchMinute = periodMinuteFloor !== undefined ? Math.max(derived, periodMinuteFloor) : derived;
          periodMinuteFloor = matchMinute;
        } else {
          // Non-clocked phases (halftime, pre, full_time, ...) can't derive a minute at all —
          // freeze at the last reported one rather than resetting to 0.
          matchMinute = lastMinute;
        }
        const running = raw.Clock?.Running ?? false;

        if (period !== lastPeriod || matchMinute !== lastMinute || running !== lastRunning) {
          lastPeriod = period;
          lastMinute = matchMinute;
          lastRunning = running;
          signals.push({ kind: "clock", period, matchMinute, running, timestamp });
        }
      }

      const possession = isAmendOrDiscard ? undefined : participantToSide(raw.Possession, raw.Participant1IsHome);
      if (possession !== undefined && possession !== lastPossession) {
        lastPossession = possession;
        signals.push({ kind: "possession", team: possession, timestamp });
      }

      const event = eventProcessor.process(raw);
      if (event !== null) signals.push({ kind: "event", event });

      return signals;
    },
  };
}
