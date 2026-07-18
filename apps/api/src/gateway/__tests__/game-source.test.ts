import { describe, expect, it } from "vitest";
import { MatchSignalBus } from "../../ingestion/event-bus.js";
import { calculateLobbyDurationMs, createGameSource } from "../game-source.js";

describe("game source", () => {
  it("keeps live entry open until kickoff", () => {
    const now = new Date("2026-07-18T20:40:00.000Z");
    const kickoff = new Date("2026-07-18T21:00:00.000Z");

    expect(calculateLobbyDurationMs("live", kickoff, 180_000, now.getTime())).toBe(20 * 60_000);
    expect(calculateLobbyDurationMs("live", kickoff, 180_000, kickoff.getTime() + 1)).toBe(0);
    expect(calculateLobbyDurationMs("replay", kickoff, 180_000, now.getTime())).toBe(180_000);
  });

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
      label: "RECORDED REPLAY",
      fixture: { fixtureId: 18179764, homeTeam: "England", awayTeam: "Senegal" },
    });
    expect(signalCount).toBeGreaterThan(0);
  });
});
