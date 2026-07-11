// Collapses the raw feed's provisional/confirmed/discard message sequence for one physical
// incident (correlated by the feed's `Id`, which repeats across those messages) into a
// single, confirmed-only LiveEvent emission per incident.
//
// Confirmed-only, deliberately simple: a provisional (Confirmed:false) message is never
// emitted; the first Confirmed:true message for that Id emits once (later duplicate confirms
// for the same Id are ignored); an `action_discarded` message is dropped outright. `action_amend`
// is not handled — out of scope for this MVP (an amend to an already-emitted confirmed event
// does not retract or correct it).

import type { LiveEvent } from "@arena/contracts";
import { normalizeEvent } from "./normalize.js";
import type { ScoreSnapshot } from "./score-snapshot.js";
import { targetEventTypeForAction } from "./whitelist.js";

export interface LiveEventProcessor {
  /** Feed one raw message through the tracker; returns the LiveEvent to publish, or null. */
  process(raw: ScoreSnapshot): LiveEvent | null;
}

export function createLiveEventProcessor(matchId: string): LiveEventProcessor {
  const emittedIds = new Set<number>();

  return {
    process(raw: ScoreSnapshot): LiveEvent | null {
      if (raw.Action === "action_discarded") return null;
      if (raw.Confirmed !== true) return null;
      if (targetEventTypeForAction(raw.Action) === undefined) return null;

      // Only construct the LiveEvent (id + timestamp allocation) once we know the message is
      // confirmed, whitelisted, and not a duplicate — provisional/discarded/non-target
      // messages, the vast majority of the feed, never pay for that.
      if (raw.Id !== undefined) {
        if (emittedIds.has(raw.Id)) return null; // already emitted once for this incident
        emittedIds.add(raw.Id);
      }

      return normalizeEvent(matchId, raw);
    },
  };
}
