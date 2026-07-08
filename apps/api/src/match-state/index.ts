// B2 — Match State Engine (build plan). Subscribes to the S3 MatchSignal bus, maintains
// aggregated MatchState, and pushes a fresh snapshot on every change.

export * from "./reducer.js";
export * from "./engine.js";
