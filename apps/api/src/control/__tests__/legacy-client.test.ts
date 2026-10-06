import { describe, expect, it } from "vitest";
import { buildLegacyMutationCommand } from "../legacy-client.js";

describe("legacy wizard command mapping", () => {
  it.each([
    ["autopilot.set", "", "false", { type: "autopilot.set", enabled: false }],
    ["series.priority.set", "series-1", "true", { type: "series.priority.set", gridSeriesId: "series-1", priority: true }],
    ["series.stream.set", "series-1", "", { type: "series.stream.set", gridSeriesId: "series-1", streamUrl: null }],
    ["series.skip.request", "series-1", "", { type: "series.skip.request", gridSeriesId: "series-1" }],
    ["tournament.publish", "tournament-1", "series-1", {
      type: "tournament.publish",
      gridTournamentId: "tournament-1",
      gridSeriesId: "series-1",
    }],
  ])("maps %s to its control command", (type, target, value, expected) => {
    expect(buildLegacyMutationCommand(type, target, value)).toEqual(expected);
  });
});
