// S3 — internal event bus seam (build plan). MVP: in-process EventEmitter; swap for Redis
// pub/sub only if ingestion is split into its own process (see build_plan.md open items).

import { EventEmitter } from "node:events";
import type { LiveEvent } from "@arena/contracts";

export class LiveEventBus {
  private readonly emitter = new EventEmitter();

  publish(event: LiveEvent): void {
    this.emitter.emit("liveEvent", event);
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.emitter.on("liveEvent", listener);
    return () => this.emitter.off("liveEvent", listener);
  }
}
