// Match State Engine's side-effecting edge: holds the current `MatchState`, applies
// incoming `MatchSignal`s through the pure reducer, and notifies subscribers only when the
// state actually changed (feeds round timing, the WS `match.state` push, the frontend).

import type { MatchSignal, MatchState, Uuid } from "@arena/contracts";
import type { MatchSignalBus } from "../ingestion/event-bus.js";
import { initialMatchState, reduceMatchState } from "./reducer.js";

export class MatchStateEngine {
  private state: MatchState;

  constructor(
    matchId: Uuid,
    private readonly onSnapshot?: (state: MatchState) => void,
  ) {
    this.state = initialMatchState(matchId);
  }

  get snapshot(): MatchState {
    return this.state;
  }

  apply(signal: MatchSignal): MatchState {
    const next = reduceMatchState(this.state, signal);
    if (next !== this.state) {
      this.state = next;
      this.onSnapshot?.(next);
    }
    return this.state;
  }

  /** Subscribes to `bus`, applying every published signal. Returns an unsubscribe function. */
  subscribeTo(bus: MatchSignalBus): () => void {
    return bus.subscribe((signal) => this.apply(signal));
  }
}
