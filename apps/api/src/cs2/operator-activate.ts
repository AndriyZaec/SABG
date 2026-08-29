import { z } from "zod";
import { closeDatabaseConnection } from "../db/client.js";
import { synchronizeCs2Catalog } from "./catalog-synchronizer.js";
import { GridCentralDataClient } from "./central-data-client.js";
import { operatorDiscoveryWindow, selectOperatorSeries } from "./operator-discovery.js";

const SafeGridIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

export async function activateCs2Series(
  requestedSeriesId: string,
  options: {
    now?: Date;
    client?: Pick<GridCentralDataClient, "fetchSeries" | "fetchSeriesById">;
    synchronize?: typeof synchronizeCs2Catalog;
  } = {},
): Promise<{ tournamentId: string; seriesId: string; scheduledStartTime: Date; syncedSeries: number }> {
  const safeSeriesId = SafeGridIdSchema.parse(requestedSeriesId);
  const now = options.now ?? new Date();
  const window = operatorDiscoveryWindow(now);
  const client = options.client ?? new GridCentralDataClient();
  const requested = await client.fetchSeriesById(safeSeriesId);
  if (requested === undefined) throw new Error(`GRID Series ${safeSeriesId} was not found`);
  const tournamentId = SafeGridIdSchema.parse(requested.competition.gridTournamentId);
  const tournamentSeries = await client.fetchSeries(window, [tournamentId]);
  const selected = selectOperatorSeries(tournamentSeries, safeSeriesId);
  const result = await (options.synchronize ?? synchronizeCs2Catalog)(window, {
    now,
    tournamentIds: [tournamentId],
    source: { fetchSeries: async () => tournamentSeries },
  });
  if (result.persisted === 0) throw new Error(`GRID tournament ${tournamentId} had no Series to synchronize`);

  return {
    tournamentId,
    seriesId: selected.gridSeriesId,
    scheduledStartTime: selected.scheduledStartTime,
    syncedSeries: result.persisted,
  };
}

async function main(): Promise<void> {
  const activation = await activateCs2Series(SafeGridIdSchema.parse(process.env["CS2_OPERATOR_SERIES_ID"]));
  process.stdout.write(`SABG_CS2_TOURNAMENT_ID=${activation.tournamentId}\n`);
  process.stdout.write(`SABG_CS2_SERIES_ID=${activation.seriesId}\n`);
  process.stdout.write(`SABG_CS2_SCHEDULED_START_TIME=${activation.scheduledStartTime.toISOString()}\n`);
  process.stdout.write(`SABG_CS2_SYNCED_SERIES=${activation.syncedSeries}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown CS2 activation error";
      const safeMessage = message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
      process.stderr.write(`CS2 activation failed: ${safeMessage}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabaseConnection());
}
