import { z } from "zod";
import { GridCentralDataClient, type GridCatalogSeries, type GridCatalogWindow } from "./central-data-client.js";

const DiscoveryConfigSchema = z.object({
  CS2_DISCOVERY_LOOKBACK_HOURS: z.coerce.number().int().nonnegative().max(168).default(24),
  CS2_DISCOVERY_LOOKAHEAD_DAYS: z.coerce.number().int().positive().max(90).default(30),
});

type OperatorSeriesSelection =
  | { state: "selectable" }
  | { state: "disabled"; reason: "PARTICIPANTS_INCOMPLETE" | "FULL_LIVE_DATA_UNAVAILABLE" };

export function selectionFor(series: GridCatalogSeries): OperatorSeriesSelection {
  if (series.teams.length !== 2) return { state: "disabled", reason: "PARTICIPANTS_INCOMPLETE" };
  if (!series.hasFullLiveData) return { state: "disabled", reason: "FULL_LIVE_DATA_UNAVAILABLE" };
  return { state: "selectable" };
}

export function selectOperatorSeries(series: readonly GridCatalogSeries[], gridSeriesId: string): GridCatalogSeries {
  const selected = series.find((item) => item.gridSeriesId === gridSeriesId);
  if (selected === undefined) throw new Error(`GRID Series ${gridSeriesId} was not found in the operator discovery window`);
  const selection = selectionFor(selected);
  if (selection.state === "disabled") throw new Error(`GRID Series ${gridSeriesId} is not selectable: ${selection.reason}`);
  return selected;
}

export function selectOperatorTournament(
  series: readonly GridCatalogSeries[],
  gridTournamentId: string,
): GridCatalogSeries[] {
  const selected = series.filter((item) => item.competition.gridTournamentId === gridTournamentId);
  if (selected.length === 0) {
    throw new Error(`GRID tournament ${gridTournamentId} was not found in the operator discovery window`);
  }
  return selected;
}

export function buildDiscoveryWindow(now: Date, lookbackHours: number, lookaheadDays: number): GridCatalogWindow {
  return {
    from: new Date(now.getTime() - lookbackHours * 60 * 60 * 1_000),
    to: new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1_000),
  };
}

export function operatorDiscoveryWindow(now: Date, env: NodeJS.ProcessEnv = process.env): GridCatalogWindow {
  const config = DiscoveryConfigSchema.parse(env);
  return buildDiscoveryWindow(now, config.CS2_DISCOVERY_LOOKBACK_HOURS, config.CS2_DISCOVERY_LOOKAHEAD_DAYS);
}

export function buildOperatorDiscoveryPayload(window: GridCatalogWindow, series: readonly GridCatalogSeries[]) {
  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    series: series.map((item) => ({
      gridSeriesId: item.gridSeriesId,
      format: item.format,
      scheduledStartTime: item.scheduledStartTime.toISOString(),
      competition: item.competition,
      teams: item.teams,
      liveDataServiceLevel: item.hasFullLiveData ? "FULL" : "UNAVAILABLE",
      selection: selectionFor(item),
    })),
  };
}

async function main(): Promise<void> {
  const window = operatorDiscoveryWindow(new Date());
  const series = await new GridCentralDataClient().discoverSeries(window);
  const payload = Buffer.from(JSON.stringify(buildOperatorDiscoveryPayload(window, series)), "utf8").toString("base64url");
  process.stdout.write(`SABG_CS2_DISCOVERY=${payload}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown CS2 operator discovery error";
    const safeMessage = message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
    process.stderr.write(`CS2 operator discovery failed: ${safeMessage}\n`);
    process.exitCode = 1;
  });
}
