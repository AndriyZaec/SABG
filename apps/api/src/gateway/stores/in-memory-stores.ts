// Shared dev/test adapter: wraps B4's in-memory doubles (settlement/prediction-store.ts,
// settlement/arena-player-store.ts) to satisfy ArenaRuntime's slightly wider store interfaces —
// no Postgres needed. Sits alongside this directory's pg-*-store.ts siblings (the real,
// Postgres-backed adapters for the same interfaces). Used by both the headless replay demo
// (replay/run.ts) and gateway/__tests__/arena-runtime.test.ts, which previously carried two
// independent copies of this exact wiring.

import type { Uuid } from "@arena/contracts";
import { createInMemoryPredictionStore } from "../../settlement/prediction-store.js";
import { createInMemoryArenaPlayerStore } from "../../settlement/arena-player-store.js";
import type { RuntimeArenaPlayerStore, RuntimePredictionStore } from "../arena-runtime.js";

export function createInMemoryRuntimeStores(
  arenaId: Uuid,
  initialActivePlayerIds: Uuid[],
): { predictionStore: RuntimePredictionStore; arenaPlayerStore: RuntimeArenaPlayerStore } {
  const innerPredictions = createInMemoryPredictionStore();
  const innerPlayers = createInMemoryArenaPlayerStore(arenaId, initialActivePlayerIds);

  const predictionStore: RuntimePredictionStore = {
    getAnswers: innerPredictions.getAnswers,
    recordResult: innerPredictions.recordResult,
    getResult: innerPredictions.getResult,
    recordAnswer(roundId, userId, answer, _receivedAt) {
      innerPredictions.recordAnswer(roundId, userId, answer);
    },
  };

  const arenaPlayerStore: RuntimeArenaPlayerStore = {
    getActivePlayerIds: innerPlayers.getActivePlayerIds,
    getStatus: innerPlayers.getStatus,
    setStatus: innerPlayers.setStatus,
    // Callers of this in-memory adapter seed the full roster up front — no late-join flow.
    addPlayer(userId) {
      innerPlayers.setStatus(userId, "active");
    },
  };

  return { predictionStore, arenaPlayerStore };
}
