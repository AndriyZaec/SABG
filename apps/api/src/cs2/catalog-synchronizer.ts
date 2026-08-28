import type { Cs2SeriesLifecycle } from "@arena/contracts";
import { cs2CatalogRepository, type Cs2CatalogSeriesInput } from "../db/repositories/cs2-catalog.repository.js";
import { cs2CatalogConfig } from "./catalog-config.js";
import { GridCentralDataClient, type GridCatalogSeries, type GridCatalogWindow } from "./central-data-client.js";

export interface Cs2CatalogSource {
  fetchSeries(window: GridCatalogWindow, tournamentIds: readonly string[], signal?: AbortSignal): Promise<GridCatalogSeries[]>;
}

export interface Cs2CatalogStore {
  synchronizeSeries(input: Cs2CatalogSeriesInput): Promise<{ seriesId: string; participantCount: number }>;
}

export interface Cs2CatalogSyncResult {
  discovered: number;
  persisted: number;
  supported: number;
  incompleteParticipants: number;
}

function catalogLifecycle(series: GridCatalogSeries, now: Date): Cs2SeriesLifecycle {
  return series.scheduledStartTime > now ? "upcoming" : "unknown";
}

export async function synchronizeCs2Catalog(
  window: GridCatalogWindow,
  options: {
    now?: Date;
    signal?: AbortSignal;
    source?: Cs2CatalogSource;
    store?: Cs2CatalogStore;
    tournamentIds?: readonly string[];
  } = {},
): Promise<Cs2CatalogSyncResult> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("CS2 catalog synchronization time is invalid");
  const source = options.source ?? new GridCentralDataClient();
  const store = options.store ?? cs2CatalogRepository;
  const tournamentIds = [...new Set(options.tournamentIds ?? cs2CatalogConfig.tournamentIds)];
  if (tournamentIds.length === 0) return { discovered: 0, persisted: 0, supported: 0, incompleteParticipants: 0 };
  const selectedTournamentIds = new Set(tournamentIds);
  const providerSeries = await source.fetchSeries(window, tournamentIds, options.signal);
  const discovered = providerSeries.filter((series) => selectedTournamentIds.has(series.competition.gridTournamentId));
  const seen = new Set<string>();
  let persisted = 0;
  let supported = 0;
  let incompleteParticipants = 0;

  for (const series of discovered) {
    if (seen.has(series.gridSeriesId)) continue;
    seen.add(series.gridSeriesId);
    await store.synchronizeSeries({
      gridSeriesId: series.gridSeriesId,
      competition: series.competition,
      format: series.format,
      scheduledStartTime: series.scheduledStartTime,
      lifecycle: catalogLifecycle(series, now),
      isSupported: series.hasFullLiveData,
      teams: series.teams,
    });
    persisted += 1;
    if (series.hasFullLiveData) supported += 1;
    if (series.teams.length < 2) incompleteParticipants += 1;
  }

  return { discovered: discovered.length, persisted, supported, incompleteParticipants };
}
