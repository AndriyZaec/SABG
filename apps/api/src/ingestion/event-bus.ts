// Internal event bus seam. MVP: in-process EventEmitter; swap for Redis pub/sub only if
// ingestion is split into its own process. Carries `MatchSignal` (settlement events +
// clock/possession) rather than just `LiveEvent`, since downstream engines (Match State) need
// more than the settlement whitelist.

import { EventEmitter } from "node:events";
import type { MatchSignal } from "@arena/contracts";

export class MatchSignalBus {
  private readonly emitter = new EventEmitter();

  publish(signal: MatchSignal): void {
    this.emitter.emit("matchSignal", signal);
  }

  subscribe(listener: (signal: MatchSignal) => void): () => void {
    this.emitter.on("matchSignal", listener);
    return () => this.emitter.off("matchSignal", listener);
  }
}
