import { describe, expect, it } from "vitest";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { createGameSource } from "../game-source.js";

describe("game source", () => {
  it("runs a recorded fixture without importing live dependencies", async () => {
    const source = await createGameSource({
      kind: "replay",
      replayFixtureId: 18179764,
      secondsPerMatchMinute: 0,
      signal: new AbortController().signal,
    });
    const bus = new MatchSignalBus();
    let signalCount = 0;
    bus.subscribe(() => {
      signalCount += 1;
    });

    await source.run({ bus, matchId: "match-1", signal: new AbortController().signal });

    expect(source).toMatchObject({
      kind: "replay",
      label: "DEMO - RECORDED REPLAY",
      fixture: { fixtureId: 18179764, homeTeam: "England", awayTeam: "Senegal" },
    });
    expect(signalCount).toBeGreaterThan(0);
  });
});
