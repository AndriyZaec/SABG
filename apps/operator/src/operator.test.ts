import { describe, expect, it } from "vitest";
import {
  buildSshInvocation,
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
    expect(buildSshInvocation(config, "start-cs2", "2995306", "START CS2 2995306")).toEqual({
      remote: "sh -s -- '/opt/sabg/event' 'start-cs2' '2995306' 'START CS2 2995306'",
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
        "sh -s -- '/opt/sabg/event' 'start-cs2' '2995306' 'START CS2 2995306'",
      ],
    });
  });

  it("rejects mismatched confirmations before spawning SSH", () => {
    expect(() => buildSshInvocation(config, "stop-cs2", "2995306", "yes")).toThrow(
      "Invalid confirmation for stop-cs2",
    );
  });
});

describe("runtime status", () => {
  it("parses the remote status protocol", () => {
    expect(parseRuntimeStatus("MODE=catalog\nTOURNAMENT_ID=830487\nAPP_HEALTH=healthy\nUNFINISHED_ARENAS=0\n")).toMatchObject({
      mode: "catalog",
      tournamentId: "830487",
      seriesId: "",
      appHealth: "healthy",
      unfinishedArenas: "0",
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
