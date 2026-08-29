import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Cs2OperatorDiscoveryPayload } from "@arena/contracts";

export type RemoteCommand = "status" | "discover-cs2" | "inspect-cs2" | "publish-cs2" | "start-cs2" | "stop-cs2" | "logs";

export interface OperatorConfig {
  host: string;
  user: string;
  deployPath: string;
  sshKey: string;
}

export interface RuntimeStatus {
  mode: string;
  tournamentId: string;
  seriesId: string;
  scheduledStartTime: string;
  revision: string;
  appHealth: string;
  unfinishedArenas: string;
}

export interface DiscoveredSeries {
  id: string;
  tournamentId: string;
  tournamentName: string;
  teams: string;
  scheduledStartTime: string;
  format: number;
  serviceLevel: string;
  selectable: boolean;
  reason: string;
}

export interface DiscoveredTournament {
  id: string;
  name: string;
  scheduledStartTime: string;
  series: DiscoveredSeries[];
}

const SAFE_HOST = /^[A-Za-z0-9:._-]+$/;
const SAFE_USER = /^[A-Za-z0-9._-]+$/;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_GRID_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined || value === "") throw new Error(`${key} is missing`);
  return value;
}

export function parseOperatorConfig(source: string): OperatorConfig {
  const values = new Map<string, string>();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const config = {
    host: required(values, "EVENT_HOST"),
    user: required(values, "EVENT_USER"),
    deployPath: required(values, "EVENT_DEPLOY_PATH"),
    sshKey: required(values, "EVENT_SSH_KEY"),
  };
  if (!SAFE_HOST.test(config.host)) throw new Error("EVENT_HOST is invalid");
  if (!SAFE_USER.test(config.user)) throw new Error("EVENT_USER is invalid");
  if (!SAFE_PATH.test(config.deployPath)) throw new Error("EVENT_DEPLOY_PATH is invalid");
  return config;
}

export async function loadOperatorConfig(path: string): Promise<OperatorConfig> {
  try {
    return parseOperatorConfig(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Operator config not found: ${path}`);
    }
    throw error;
  }
}

export function parseRuntimeStatus(output: string): RuntimeStatus {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return {
    mode: values.get("MODE") ?? "unknown",
    tournamentId: values.get("TOURNAMENT_ID") ?? "",
    seriesId: values.get("SERIES_ID") ?? "",
    scheduledStartTime: values.get("SCHEDULED_START_TIME") ?? "",
    revision: values.get("REVISION") ?? "unknown",
    appHealth: values.get("APP_HEALTH") ?? "unknown",
    unfinishedArenas: values.get("UNFINISHED_ARENAS") ?? "unknown",
  };
}

function clean(value: unknown, fallback = "-"): string {
  const result = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return result || fallback;
}

function gridId(value: unknown, label: string): string {
  const result = String(value ?? "");
  if (!SAFE_GRID_ID.test(result)) throw new Error(`Invalid ${label}: ${result}`);
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

export function parseDiscovery(output: string, now = new Date()): DiscoveredTournament[] {
  const series = parseDiscoverySeries(output);
  const tournaments = new Map<string, DiscoveredTournament>();
  for (const discovered of series) {
    const tournament = tournaments.get(discovered.tournamentId) ?? {
      id: discovered.tournamentId,
      name: discovered.tournamentName,
      scheduledStartTime: discovered.scheduledStartTime,
      series: [],
    };
    tournament.series.push(discovered);
    tournaments.set(discovered.tournamentId, tournament);
  }

  const currentTime = now.getTime();
  const result = [...tournaments.values()]
    .map((tournament) => {
      const nextStart = tournament.series
        .map((item) => item.scheduledStartTime)
        .filter((scheduledStartTime) => Date.parse(scheduledStartTime) >= currentTime)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      return nextStart === undefined ? undefined : { ...tournament, scheduledStartTime: nextStart };
    })
    .filter((tournament): tournament is DiscoveredTournament => tournament !== undefined)
    .sort((left, right) => Date.parse(left.scheduledStartTime) - Date.parse(right.scheduledStartTime))
    .slice(0, 25);
  if (result.length === 0) throw new Error("GRID returned no upcoming CS2 tournaments in the discovery window");
  return result;
}

export function parseDiscoverySeries(output: string): DiscoveredSeries[] {
  const marker = output.split(/\r?\n/u).find((line) => line.startsWith("SABG_CS2_DISCOVERY="));
  if (marker === undefined) throw new Error("GRID discovery did not return a CS2 payload");
  const encoded = marker.slice("SABG_CS2_DISCOVERY=".length);
  const payload = object(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    "Discovery payload",
  ) as unknown as Partial<Cs2OperatorDiscoveryPayload>;
  if (!Array.isArray(payload.series)) throw new Error("Discovery payload has no Series array");

  const series: DiscoveredSeries[] = [];
  for (const value of payload.series) {
    const source = object(value, "Discovered Series");
    const competition = object(source.competition, "Series competition");
    const selection = object(source.selection, "Series selection");
    const participants = Array.isArray(source.participants)
      ? source.participants.map((participant) => object(participant, "Series participant"))
      : [];
    if (participants.length !== 2) throw new Error(`GRID Series ${String(source.gridSeriesId)} has invalid participant slots`);
    const tournamentId = gridId(competition.gridTournamentId, "GRID tournament ID");
    const seriesId = gridId(source.gridSeriesId, "GRID Series ID");
    const scheduledStartTime = clean(source.scheduledStartTime, "");
    if (Number.isNaN(Date.parse(scheduledStartTime))) throw new Error(`Invalid schedule for GRID Series ${seriesId}`);
    series.push({
      id: seriesId,
      tournamentId,
      tournamentName: clean(competition.name),
      teams: participants.map((participant) => {
        if (participant.state !== "known") return "TBD";
        const team = object(participant.team, "Series participant team");
        return clean(team.shortName ?? team.name, "TBD");
      }).join(" vs "),
      scheduledStartTime,
      format: Number(source.format),
      serviceLevel: clean(source.liveDataServiceLevel, "UNAVAILABLE"),
      selectable: selection.state === "selectable",
      reason: clean(selection.reason, "UNAVAILABLE"),
    });
  }
  return series;
}

export function assertGridId(value: string): string {
  if (!SAFE_GRID_ID.test(value)) throw new Error("GRID Series ID is invalid");
  return value;
}

export function buildSshInvocation(
  config: OperatorConfig,
  command: RemoteCommand,
  argument = "",
  confirmation = "",
): { args: string[]; remote: string } {
  if (argument !== "") assertGridId(argument);
  const expectedConfirmation = command === "start-cs2"
    ? `START CS2 ${argument}`
    : command === "stop-cs2"
      ? `STOP CS2 ${argument}`
      : undefined;
  if (expectedConfirmation !== undefined && confirmation !== expectedConfirmation) {
    throw new Error(`Invalid confirmation for ${command}`);
  }
  if (command === "publish-cs2" && !/^PUBLISH CS2 [A-Za-z0-9._:-]{1,200}$/u.test(confirmation)) {
    throw new Error("Invalid confirmation for publish-cs2");
  }
  const remote = `sh -s -- '${config.deployPath}' '${command}' '${argument}' '${confirmation}'`;
  return {
    remote,
    args: [
      "-i",
      config.sshKey,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      `${config.user}@${config.host}`,
      remote,
    ],
  };
}

export async function runRemote(
  config: OperatorConfig,
  scriptPath: string,
  command: RemoteCommand,
  argument = "",
  confirmation = "",
  onOutput?: (chunk: string) => void,
): Promise<string> {
  const invocation = buildSshInvocation(config, command, argument, confirmation);
  const child = spawn("ssh", invocation.args, { stdio: ["pipe", "pipe", "pipe"] });

  let output = "";
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    output += text;
    onOutput?.(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  createReadStream(scriptPath).pipe(child.stdin);

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `Remote command exited with status ${String(code)}`));
    });
  });
}
