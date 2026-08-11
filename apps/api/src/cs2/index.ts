// CS2 discipline module (cs2-migration-spec/spec_v2.md). Snapshot -> round-tracker (pure
// MatchSignal reducer) -> Cs2RoundEngine (round lifecycle, MatchSignalBus-driven) -> catalog +
// settle (question generation / snapshot-diff settlement, wrapped by question-provider.ts).
//
// series-orchestrator.ts is deliberately NOT re-exported here — it transitively imports
// db/client.ts, which throws synchronously at import time when DATABASE_URL is unset (see that
// file's own comment). Keeping this barrel DB-free means every other module here stays safely
// importable without a database — import series-orchestrator.js directly where it's needed.

export * from "./snapshot.js";
export * from "./round-tracker.js";
export * from "./catalog.js";
export * from "./settle.js";
export * from "./question-provider.js";
export * from "./round-engine.js";
export * from "./fixture.js";
export * from "./series-snapshot.js";
export * from "./series-lifecycle.js";
export * from "./arena-runtime.js";
