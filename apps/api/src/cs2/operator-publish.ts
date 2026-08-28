import { z } from "zod";
import { closeDatabaseConnection } from "../db/client.js";
import { synchronizeCs2Catalog } from "./catalog-synchronizer.js";
import { GridCentralDataClient } from "./central-data-client.js";
import { operatorDiscoveryWindow, selectOperatorTournament } from "./operator-discovery.js";

const SafeGridIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

async function main(): Promise<void> {
  const requestedTournamentId = SafeGridIdSchema.parse(process.env["CS2_OPERATOR_TOURNAMENT_ID"]);
  const now = new Date();
  const window = operatorDiscoveryWindow(now);
  const client = new GridCentralDataClient();
  const discovered = await client.discoverSeries(window);
  const tournamentSeries = selectOperatorTournament(discovered, requestedTournamentId);
  const result = await synchronizeCs2Catalog(window, {
    now,
    tournamentIds: [requestedTournamentId],
    source: { fetchSeries: async () => tournamentSeries },
  });
  if (result.persisted === 0) throw new Error(`GRID tournament ${requestedTournamentId} had no Series to synchronize`);
  if (result.supported === 0) throw new Error(`GRID tournament ${requestedTournamentId} had no supported Series to publish`);

  process.stdout.write(`SABG_CS2_TOURNAMENT_ID=${requestedTournamentId}\n`);
  process.stdout.write(`SABG_CS2_SYNCED_SERIES=${result.persisted}\n`);
  process.stdout.write(`SABG_CS2_SUPPORTED_SERIES=${result.supported}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown CS2 publication error";
      const safeMessage = message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
      process.stderr.write(`CS2 publication failed: ${safeMessage}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabaseConnection());
}
