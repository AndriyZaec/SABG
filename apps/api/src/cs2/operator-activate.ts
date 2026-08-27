import { z } from "zod";
import { closeDatabaseConnection } from "../db/client.js";
import { synchronizeCs2Catalog } from "./catalog-synchronizer.js";
import { GridCentralDataClient } from "./central-data-client.js";
import { operatorDiscoveryWindow, selectOperatorSeries } from "./operator-discovery.js";

const SafeGridIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

async function main(): Promise<void> {
  const requestedSeriesId = SafeGridIdSchema.parse(process.env["CS2_OPERATOR_SERIES_ID"]);
  const now = new Date();
  const window = operatorDiscoveryWindow(now);
  const client = new GridCentralDataClient();
  const discovered = await client.discoverSeries(window);
  const selected = selectOperatorSeries(discovered, requestedSeriesId);
  const tournamentId = SafeGridIdSchema.parse(selected.competition.gridTournamentId);
  const tournamentSeries = discovered.filter((series) => series.competition.gridTournamentId === tournamentId);
  const result = await synchronizeCs2Catalog(window, {
    now,
    tournamentIds: [tournamentId],
    source: { fetchSeries: async () => tournamentSeries },
  });
  if (result.persisted === 0) throw new Error(`GRID tournament ${tournamentId} had no Series to synchronize`);

  process.stdout.write(`SABG_CS2_TOURNAMENT_ID=${tournamentId}\n`);
  process.stdout.write(`SABG_CS2_SERIES_ID=${selected.gridSeriesId}\n`);
  process.stdout.write(`SABG_CS2_SCHEDULED_START_TIME=${selected.scheduledStartTime.toISOString()}\n`);
  process.stdout.write(`SABG_CS2_SYNCED_SERIES=${result.persisted}\n`);
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
