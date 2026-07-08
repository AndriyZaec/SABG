// B3 — Round Engine (build plan). Subscribes to the S3 MatchSignal bus and drives round
// lifecycle pending -> open -> locked off the match clock (spec §5). Settled is B4's seam.

export * from "./planner.js";
export * from "./question-provider.js";
export * from "./engine.js";
