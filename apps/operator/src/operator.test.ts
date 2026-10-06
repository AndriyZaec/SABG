import { describe, expect, it } from "vitest";
import {
  buildSshInvocation,
  normalizeStreamUrl,
  parseDiscovery,
  parseDiscoverySeries,
  parseOperatorConfig,
  parseRuntimeStatus,
  type OperatorConfig,
} from "./operator.js";

const config: OperatorConfig = {
  host: "example.com",
  user: "deploy",
  deployPath: "/opt/sabg/event",
  sshKey: "/Users/operator/.ssh/id_ed25519",
};

function discovery(series: unknown[]): string {
  return `noise\nSABG_CS2_DISCOVERY=${Buffer.from(JSON.stringify({ series })).toString("base64url")}\n`;
}

function item(id: number, tournamentId: number, start: string): object {
  return {
    gridSeriesId: String(id),
    scheduledStartTime: start,
    format: 3,
    liveDataServiceLevel: "FULL",
    competition: { gridTournamentId: String(tournamentId), name: `Tournament ${tournamentId}` },
    participants: [
      { state: "known", displayOrder: 1, team: { shortName: "A" } },
      { state: "known", displayOrder: 2, team: { shortName: "B" } },
    ],
    selection: { state: "selectable" },
  };
}

describe("operator config", () => {
  it("reads and validates local SSH settings", () => {
    expect(parseOperatorConfig(`
EVENT_HOST=example.com
EVENT_USER=deploy
EVENT_DEPLOY_PATH=/opt/sabg/event
EVENT_SSH_KEY=/Users/operator/.ssh/id_ed25519
`)).toEqual(config);
  });
});

describe("remote commands", () => {
  it("passes SSH settings and an exact remote command without a local shell", () => {
    expect(buildSshInvocation(config, "skip-cs2", "2995306", "SKIP CS2 2995306")).toEqual({
      remote: "sh -s -- '/opt/sabg/event' 'skip-cs2' '2995306' 'SKIP CS2 2995306'",
      args: [
        "-i",
        "/Users/operator/.ssh/id_ed25519",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "deploy@example.com",
        "sh -s -- '/opt/sabg/event' 'skip-cs2' '2995306' 'SKIP CS2 2995306'",
      ],
    });
  });

  it("rejects a skip whose confirmation names another series or nothing", () => {
    expect(() => buildSshInvocation(config, "skip-cs2", "2995306", "SKIP CS2 2995307")).toThrow(
      "Invalid confirmation for skip-cs2",
    );
    expect(() => buildSshInvocation(config, "skip-cs2", "2995306", "yes")).toThrow(
      "Invalid confirmation for skip-cs2",
    );
  });

  it.each(["prioritize-cs2", "unprioritize-cs2"] as const)("sends %s with the series id and no confirmation", (command) => {
    expect(buildSshInvocation(config, command, "2995306").remote).toBe(
      `sh -s -- '/opt/sabg/event' '${command}' '2995306' ''`,
    );
  });

  it.each(["prioritize-cs2", "unprioritize-cs2", "skip-cs2"] as const)("refuses %s without a series id", (command) => {
    expect(() => buildSshInvocation(config, command, "", "SKIP CS2 ")).toThrow(`${command} needs a GRID Series ID`);
  });

  it("rejects a series id that could break out of the remote command", () => {
    expect(() => buildSshInvocation(config, "prioritize-cs2", "1'; drop table series; --")).toThrow(
      "GRID Series ID is invalid",
    );
  });

  it("sends set-stream-cs2 with the normalized URL as the fifth value", () => {
    expect(buildSshInvocation(config, "set-stream-cs2", "2995306", "", "https://kick.com/user-name").remote).toBe(
      "sh -s -- '/opt/sabg/event' 'set-stream-cs2' '2995306' '' 'https://kick.com/user-name'",
    );
  });

  it.each([
    ["a link that isn't normalized", "twitch.tv/ESLCS"],
    ["a value that could break out of the remote command", "https://twitch.tv/x' ; rm -rf / ; '"],
    ["no URL", ""],
  ])("refuses set-stream-cs2 with %s", (_label, value) => {
    expect(() => buildSshInvocation(config, "set-stream-cs2", "2995306", "", value)).toThrow();
  });

  it("sends clear-stream-cs2 with the series id and no value", () => {
    expect(buildSshInvocation(config, "clear-stream-cs2", "2995306").remote).toBe(
      "sh -s -- '/opt/sabg/event' 'clear-stream-cs2' '2995306' ''",
    );
  });

  it.each(["set-stream-cs2", "clear-stream-cs2"] as const)("refuses %s without a series id", (command) => {
    expect(() => buildSshInvocation(config, command, "", "", "https://twitch.tv/eslcs")).toThrow(`${command} needs a GRID Series ID`);
  });

  it("refuses a stream URL on any other command", () => {
    expect(() => buildSshInvocation(config, "clear-stream-cs2", "2995306", "", "https://twitch.tv/eslcs")).toThrow(
      "clear-stream-cs2 takes no stream URL",
    );
  });

  it.each(["autopilot-on", "autopilot-off"] as const)("sends %s without an argument", (command) => {
    expect(buildSshInvocation(config, command).remote).toBe(`sh -s -- '/opt/sabg/event' '${command}' '' ''`);
  });
});

describe("stream URL", () => {
  it.each([
    ["twitch.tv/ESLCS", "https://twitch.tv/eslcs"],
    ["https://www.twitch.tv/eslcs/", "https://twitch.tv/eslcs"],
    ["https://m.twitch.tv/eslcs?x=1", "https://twitch.tv/eslcs"],
    [" http://twitch.tv/esl_csgo#chat ", "https://twitch.tv/esl_csgo"],
    ["kick.com/SomeChannel", "https://kick.com/SomeChannel"],
    ["https://kick.com/user_name", "https://kick.com/user-name"],
    ["https://www.kick.com/some-channel/", "https://kick.com/some-channel"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeStreamUrl(input)).toBe(expected);
  });

  it.each([
    "https://www.youtube.com/watch?v=abc",
    "https://twitch.tv/videos/123",
    "https://twitch.tv/",
    "https://twitch.tv/a'b",
    "https://twitch.tv/some-name",
    "https://twitch.tv/_eslcs",
    "https://twitch.tv/abc",
    "https://kick.com/",
    "https://evil.com/twitch.tv/eslcs",
    "https://twitch.tv.evil.com/eslcs",
    "ftp://twitch.tv/eslcs",
  ])("rejects %s", (input) => {
    expect(() => normalizeStreamUrl(input)).toThrow();
  });
});

describe("runtime status", () => {
  it("parses the remote status protocol", () => {
    expect(parseRuntimeStatus(
      "TOURNAMENT_ID=830487\nAUTOPILOT=on\nRUNNING_SERIES=3002933\nPRIORITY_SERIES=3002934,3002940\nSERIES_STREAMS=3002933=https://twitch.tv/eslcs,3002934=https://kick.com/user-name\nAPP_HEALTH=healthy\nUNFINISHED_ARENAS=1\n",
    )).toMatchObject({
      tournamentId: "830487",
      autopilot: "on",
      runningSeries: ["3002933"],
      prioritySeries: ["3002934", "3002940"],
      seriesStreams: { "3002933": "https://twitch.tv/eslcs", "3002934": "https://kick.com/user-name" },
      appHealth: "healthy",
      unfinishedArenas: "1",
    });
  });

  it("finds no stream for an id that names an Object.prototype property", () => {
    const { seriesStreams } = parseRuntimeStatus("SERIES_STREAMS=__proto__=https://twitch.tv/eslcs\n");
    expect(seriesStreams["constructor"]).toBeUndefined();
    expect(seriesStreams["toString"]).toBeUndefined();
    expect(seriesStreams["__proto__"]).toBe("https://twitch.tv/eslcs");
  });

  it("reads missing autopilot lines as unknown with no series", () => {
    expect(parseRuntimeStatus("TOURNAMENT_ID=830487\nRUNNING_SERIES=\n")).toMatchObject({
      autopilot: "unknown",
      runningSeries: [],
      prioritySeries: [],
      seriesStreams: {},
    });
  });
});

describe("operator discovery", () => {
  it("groups Series and returns only the nearest 25 tournaments", () => {
    const series = Array.from({ length: 27 }, (_, index) => item(index + 1, index + 1, `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`));
    series.push(item(100, 1, "2026-09-01T16:00:00.000Z"));

    const result = parseDiscovery(discovery(series), new Date("2026-08-31T12:00:00.000Z"));

    expect(result).toHaveLength(25);
    expect(result[0]).toMatchObject({ id: "1", series: [{ id: "1" }, { id: "100" }] });
    expect(result.at(-1)?.id).toBe("25");
  });

  it("omits past tournaments while retaining past Series in an upcoming tournament", () => {
    const result = parseDiscovery(discovery([
      item(1, 1, "2026-08-30T12:00:00.000Z"),
      item(2, 1, "2026-09-02T12:00:00.000Z"),
      item(3, 2, "2026-08-29T12:00:00.000Z"),
    ]), new Date("2026-09-01T12:00:00.000Z"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "1", scheduledStartTime: "2026-09-02T12:00:00.000Z" });
    expect(result[0]?.series).toHaveLength(2);
  });

  it("exposes every discovered Series for exact-ID lookup", () => {
    expect(parseDiscoverySeries(discovery([item(42, 9, "2026-09-02T12:00:00.000Z")]))[0]).toMatchObject({
      id: "42",
      tournamentId: "9",
      teams: "A vs B",
      selectable: true,
    });
  });

  it("preserves TBD participant slot order in labels", () => {
    const source = item(42, 9, "2026-09-02T12:00:00.000Z") as {
      participants: [{ state: string; displayOrder: number; team?: unknown }, { state: string; displayOrder: number; team?: unknown }];
    };
    source.participants[0] = { state: "tbd", displayOrder: 1 };

    expect(parseDiscoverySeries(discovery([source]))[0]?.teams).toBe("TBD vs B");
  });
});
