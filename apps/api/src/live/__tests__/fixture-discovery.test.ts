import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_FIXTURE_LOOKAHEAD_MS,
  discoverWorldCupFixture,
  fetchWorldCupSnapshot,
  selectWorldCupFixture,
  type FixtureDiscoveryClient,
  type FixtureSnapshot,
} from "../fixture-discovery.js";

const NOW = Date.UTC(2026, 6, 18, 18, 0, 0);

function fixture(overrides: Partial<FixtureSnapshot> = {}): FixtureSnapshot {
  return {
    FixtureId: 100,
    StartTime: NOW,
    CompetitionId: 72,
    Participant1: "France",
    Participant2: "Brazil",
    ...overrides,
  };
}

describe("fixture discovery", () => {
  it("fetches the authenticated snapshot path and filters out friendlies", async () => {
    const get = vi.fn(async () => ({
      data: [
        fixture({ GameState: 1, Competition: "World Cup" }),
        fixture({ FixtureId: 200, CompetitionId: 99, Competition: "Friendly" }),
      ],
    }));
    const client: FixtureDiscoveryClient = { get };

    const snapshot = await fetchWorldCupSnapshot(client);

    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/fixtures/snapshot");
    expect(snapshot.map((item) => item.FixtureId)).toEqual([100]);
    expect(snapshot[0]).toMatchObject({ GameState: 1, Competition: "World Cup" });
  });

  it("uses Participant1IsHome when ordering teams and defaults Participant1 to home", () => {
    expect(selectWorldCupFixture([fixture()], { now: NOW })).toMatchObject({
      homeTeam: "France",
      awayTeam: "Brazil",
    });
    expect(
      selectWorldCupFixture([fixture({ Participant1IsHome: false })], { now: NOW }),
    ).toMatchObject({ homeTeam: "Brazil", awayTeam: "France" });
  });

  it("requires an explicit override to exist in the filtered World Cup snapshot", () => {
    const snapshot = [
      fixture(),
      fixture({ FixtureId: 200, CompetitionId: 99, Participant1: "Club A", Participant2: "Club B" }),
    ];

    expect(() => selectWorldCupFixture(snapshot, { now: NOW, fixtureId: 200 })).toThrow(
      /Fixture override 200 is not in the World Cup snapshot.*id=100.*France.*Brazil/,
    );
  });

  it("selects the only fixture in the inclusive current window", async () => {
    const client: FixtureDiscoveryClient = {
      get: async () => ({
        data: [
          fixture({ FixtureId: 101, StartTime: NOW + CURRENT_FIXTURE_LOOKAHEAD_MS }),
          fixture({ FixtureId: 102, StartTime: NOW - 1 }),
        ],
      }),
    };

    await expect(discoverWorldCupFixture({ client, now: NOW })).resolves.toEqual({
      fixtureId: 101,
      homeTeam: "France",
      awayTeam: "Brazil",
      startTime: NOW + CURRENT_FIXTURE_LOOKAHEAD_MS,
    });
  });

  it("throws an actionable error when there are no current candidates", () => {
    const future = fixture({
      FixtureId: 301,
      StartTime: NOW + CURRENT_FIXTURE_LOOKAHEAD_MS + 1,
      Participant1: "Spain\n",
      Participant2: "Argentina",
    });

    expect(() => selectWorldCupFixture([future], { now: NOW })).toThrow(
      /found 0.*id=301.*Spain.*Argentina.*2026-07-18T18:30:00\.001Z.*explicit fixture override/,
    );
  });

  it("throws sanitized candidate details when current selection is ambiguous", () => {
    const snapshot = [
      { ...fixture({ FixtureId: 401, Participant1: "France\nUnited" }), AuthToken: "secret-token" },
      fixture({ FixtureId: 402, StartTime: NOW + 1_000, Participant1: "Germany" }),
    ];

    let message = "";
    try {
      selectWorldCupFixture(snapshot, { now: NOW });
    } catch (error) {
      if (error instanceof Error) message = error.message;
    }

    expect(message).toBe(
      'Expected exactly one current World Cup fixture, found 2. Current candidates: id=401 "France United" vs "Brazil" at 2026-07-18T18:00:00.000Z; id=402 "Germany" vs "Brazil" at 2026-07-18T18:00:01.000Z. Set an explicit fixture override.',
    );
    expect(message).not.toContain("secret-token");
  });

  it("rejects an invalid unknown snapshot response", async () => {
    const client: FixtureDiscoveryClient = {
      get: async () => ({ data: [fixture({ Participant1: "" })] }),
    };

    await expect(fetchWorldCupSnapshot(client)).rejects.toThrow();
  });
});
