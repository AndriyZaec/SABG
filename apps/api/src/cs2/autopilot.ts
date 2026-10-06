// One long-lived process picks, runs and resumes CS2 series on its own: one series at a time, no per-match restarts.

import type { IsoDateTime, Series, Uuid } from "@arena/contracts";
import type { PgBoss } from "pg-boss";
import { cs2CatalogRepository } from "../db/repositories/cs2-catalog.repository.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import { CS2_AUTOPILOT_SETTING, settingsRepository } from "../db/repositories/settings.repository.js";
import { releaseEntryGate } from "../gateway/entry-prepare-store.js";
import type { WriteQueue } from "../gateway/stores/write-queue.js";
import type { GatewayWebSocketServer } from "../gateway/ws.js";
import { logger } from "../grid/logger.js";
import { LATE_START_WINDOW_MS, selectNextSeries, type Cs2SeriesCandidate } from "./next-series.js";
import { Cs2SeriesRunner, type Cs2SeriesRunnerStartOptions } from "./series-runner.js";
import { synchronizeCs2Catalog } from "./catalog-synchronizer.js";
import { operatorDiscoveryWindow } from "./operator-discovery.js";

const LAUNCH_QUEUE = "cs2-autopilot-launch";
const CATALOG_SYNC_QUEUE = "cs2-catalog-sync";

export interface Cs2AutopilotRunner {
  readonly seriesId: Uuid;
  readonly gridSeriesId: string;
  openedArenaIds(): Uuid[];
  skip(): Promise<"skipped" | "refused">;
  stopPolling(): Promise<void>;
  stop(): Promise<void>;
}

export type Cs2AutopilotStartResult =
  | { kind: "started"; runner: Cs2AutopilotRunner }
  | { kind: "skipped"; reason: string }
  | { kind: "aborted" };

export interface Cs2AutopilotDeps {
  startRunner(input: {
    gridSeriesId: string;
    scheduledStartTime: IsoDateTime;
    primingDeadline?: IsoDateTime;
    signal: AbortSignal;
    onEnd: (outcome: "complete" | "overtaken") => void;
  }): Promise<Cs2AutopilotStartResult>;
  isEnabled(): Promise<boolean>;
  listCandidates(): Promise<Cs2SeriesCandidate[]>;
  listActiveRunSeries(): Promise<{ seriesId: Uuid; gridSeriesId: string; scheduledStartTime: IsoDateTime; hasOpenArena: boolean }[]>;
  findSeries(seriesId: Uuid): Promise<Series | undefined>;
  setSeriesSkipped(seriesId: Uuid): Promise<void>;
  /** Drops a finished series' arena from process memory (gateway runtime and cache, entry gate). */
  releaseArena(arenaId: Uuid): void;
  now(): Date;
  random(): number;
}

export function createCs2AutopilotDeps(runtime: {
  wsGateway: GatewayWebSocketServer;
  writeQueue: WriteQueue;
  entryFeeLamports: number;
  rawRecordingEnabled: boolean;
}): Cs2AutopilotDeps {
  return {
    startRunner: ({ onEnd, primingDeadline, ...input }) => {
      const options: Cs2SeriesRunnerStartOptions = {
        ...input,
        wsGateway: runtime.wsGateway,
        writeQueue: runtime.writeQueue,
        entryFeeLamports: runtime.entryFeeLamports,
        rawRecordingEnabled: runtime.rawRecordingEnabled,
        onEnd,
        ...(primingDeadline !== undefined ? { primingDeadline } : {}),
      };
      return Cs2SeriesRunner.start(options);
    },
    isEnabled: () => settingsRepository.isEnabled(CS2_AUTOPILOT_SETTING),
    listCandidates: () => cs2CatalogRepository.listAutopilotCandidates(),
    listActiveRunSeries: () => cs2CatalogRepository.listActiveRunSeries(),
    findSeries: (seriesId) => seriesRepository.findById(seriesId),
    setSeriesSkipped: (seriesId) => seriesRepository.setStatus(seriesId, "skipped"),
    releaseArena: (arenaId) => {
      runtime.wsGateway.unregisterRuntime(arenaId);
      releaseEntryGate(arenaId);
    },
    now: () => new Date(),
    random: Math.random,
  };
}

export class Cs2Autopilot {
  private runner: Cs2AutopilotRunner | undefined;
  /** The last finished series' arenas stay in memory until the next one ends, so reloads still see the result. */
  private retainedArenaIds: Uuid[] = [];
  /** resume, tick and a runner's end run one at a time, so a launch never races a resume or a teardown. */
  private queue: Promise<void> = Promise.resolve();
  private readonly abortController = new AbortController();
  private seriesEndListener: (() => void) | undefined;
  /** A runner is being started: its priming polls GRID, which counts as running a series. */
  private launching = false;

  constructor(private readonly deps: Cs2AutopilotDeps) {}

  /** While a series is primed or runs, GRID requests go to it alone: the catalog sync shares the same token budget. */
  get hasRunner(): boolean {
    return this.launching || this.runner !== undefined;
  }

  /** The series a started runner holds, for the catalog: it is live even before its first arena opens. */
  get runningSeriesId(): Uuid | undefined {
    return this.runner?.seriesId;
  }

  onSeriesEnded(listener: () => void): void {
    this.seriesEndListener = listener;
  }

  runWhileIdle<T>(task: () => Promise<T>): Promise<{ kind: "busy" } | { kind: "completed"; value: T }> {
    return this.enqueueResult(async () => this.hasRunner
      ? { kind: "busy" as const }
      : { kind: "completed" as const, value: await task() });
  }

  /** On process start: rebuild the series that has an open arena; abandon one that died between maps. */
  resume(): Promise<void> {
    return this.enqueue(async () => {
      const ran = await this.deps.listActiveRunSeries();
      for (const series of ran.filter((s) => !s.hasOpenArena)) {
        // No arena holds money between maps, and restore() can't tell which map is live by now.
        await this.deps.setSeriesSkipped(series.seriesId);
        logger.warn({ gridSeriesId: series.gridSeriesId }, "autopilot: series died between maps; skipped");
      }
      // A tick that ran first may have resumed it already.
      if (this.runner !== undefined || this.abortController.signal.aborted) return;
      await this.resumeOpenSeries(ran);
    });
  }

  tick(): Promise<void> {
    return this.enqueue(async () => {
      if (this.abortController.signal.aborted) return;
      if (this.runner !== undefined) {
        await this.applySkipRequest(this.runner);
        return;
      }
      // A series with an open arena holds players' money: it comes first, e.g. after a failed resume.
      if (await this.resumeOpenSeries(await this.deps.listActiveRunSeries())) return;
      if (!(await this.deps.isEnabled())) return;
      const decision = selectNextSeries(await this.deps.listCandidates(), this.deps.now().toISOString(), this.deps.random);
      if (decision.kind !== "launch") return;
      const series = await this.deps.findSeries(decision.seriesId);
      if (series === undefined) return;
      const deadline = new Date(Date.parse(series.scheduledStartTime) + LATE_START_WINDOW_MS).toISOString();
      await this.launch(series.gridSeriesId, series.scheduledStartTime, deadline, "autopilot: launched");
    });
  }

  /** Shutdown, step 1: no new launches, no more GRID polls. */
  async stopPolling(): Promise<void> {
    this.abortController.abort();
    await this.queue;
    await this.runner?.stopPolling();
  }

  /** Shutdown, step 2, once the gateway is closed: drain writes and release the series lock. */
  async stop(): Promise<void> {
    await this.stopPolling();
    await this.runner?.stop();
  }

  private async applySkipRequest(runner: Cs2AutopilotRunner): Promise<void> {
    if ((await this.deps.findSeries(runner.seriesId))?.skipRequested !== true) return;
    if ((await runner.skip()) === "skipped") await this.endRunner(runner.gridSeriesId, "skipped");
  }

  /** Returns whether a series with an open arena exists; if so it was (re)launched or will be retried next tick. */
  private async resumeOpenSeries(
    ran: Awaited<ReturnType<Cs2AutopilotDeps["listActiveRunSeries"]>>,
  ): Promise<boolean> {
    const open = ran.filter((s) => s.hasOpenArena);
    if (open.length > 1) {
      logger.error({ gridSeriesIds: open.map((s) => s.gridSeriesId) }, "autopilot: several series have open arenas; resuming the earliest");
    }
    const series = open[0];
    if (series === undefined) return false;
    // No priming deadline: its open arena holds players' money, so keep waiting for GRID.
    await this.launch(series.gridSeriesId, series.scheduledStartTime, undefined, "autopilot: resumed");
    return true;
  }

  private async launch(
    gridSeriesId: string,
    scheduledStartTime: IsoDateTime,
    primingDeadline: IsoDateTime | undefined,
    message: string,
  ): Promise<void> {
    this.launching = true;
    try {
      const result = await this.deps.startRunner({
        gridSeriesId,
        scheduledStartTime,
        signal: this.abortController.signal,
        onEnd: (outcome) => void this.enqueue(() => this.endRunner(gridSeriesId, outcome)),
        ...(primingDeadline !== undefined ? { primingDeadline } : {}),
      });
      if (result.kind === "started") {
        this.runner = result.runner;
        logger.info({ gridSeriesId }, message);
      } else if (result.kind === "skipped") {
        logger.info({ gridSeriesId, reason: result.reason }, "autopilot: series skipped");
        this.seriesEndListener?.();
      }
    } catch (err) {
      logger.error({ err, gridSeriesId }, "autopilot: failed to start the series runner");
    } finally {
      this.launching = false;
    }
  }

  private async endRunner(gridSeriesId: string, outcome: "complete" | "overtaken" | "skipped"): Promise<void> {
    const runner = this.runner;
    if (runner === undefined || runner.gridSeriesId !== gridSeriesId) return;
    try {
      await runner.stop();
      if (outcome === "overtaken") {
        // The crash-closed arena is already paid; nothing open is left to protect.
        await this.deps.setSeriesSkipped(runner.seriesId);
        logger.warn({ gridSeriesId }, "autopilot: next map was already live after a crash close; series skipped");
      } else {
        logger.info({ gridSeriesId }, outcome === "skipped" ? "autopilot: series skipped by the operator" : "autopilot: series complete");
      }
    } finally {
      // Even if stopping failed, a stuck runner must not block every later launch.
      this.runner = undefined;
      for (const arenaId of this.retainedArenaIds) this.deps.releaseArena(arenaId);
      this.retainedArenaIds = runner.openedArenaIds();
      this.seriesEndListener?.();
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    return this.enqueueResult(task);
  }

  private enqueueResult<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(() => undefined).catch((err: unknown) => logger.error({ err }, "autopilot: task failed"));
    return run;
  }
}

export async function runCs2CatalogSync(
  autopilot: Pick<Cs2Autopilot, "hasRunner">,
  options: { synchronize?: typeof synchronizeCs2Catalog; now?: Date; tournamentIds?: readonly string[] } = {},
): Promise<void> {
  if (autopilot.hasRunner) {
    logger.debug("cs2: catalog sync skipped, a series is running");
    return;
  }
  const now = options.now ?? new Date();
  try {
    const configuredTournamentId = options.tournamentIds === undefined
      ? await settingsRepository.getActiveCs2TournamentId()
      : undefined;
    const result = await (options.synchronize ?? synchronizeCs2Catalog)(operatorDiscoveryWindow(now), {
      now,
      tournamentIds: options.tournamentIds ?? (configuredTournamentId === undefined ? [] : [configuredTournamentId]),
    });
    logger.debug(result, "cs2: catalog synced");
  } catch (err) {
    logger.error({ err }, "cs2: catalog sync failed");
  }
}

export async function registerCs2AutopilotJobs(boss: PgBoss, autopilot: Cs2Autopilot): Promise<void> {
  // exclusive: a launch that waits on priming, or a slow sync, never piles up runs behind it.
  await boss.createQueue(LAUNCH_QUEUE, { policy: "exclusive" });
  await boss.schedule(LAUNCH_QUEUE, "* * * * *");
  await boss.work(LAUNCH_QUEUE, async () => {
    await autopilot.tick();
  });

  await boss.createQueue(CATALOG_SYNC_QUEUE, { policy: "exclusive" });
  await boss.schedule(CATALOG_SYNC_QUEUE, "* * * * *");
  await boss.work(CATALOG_SYNC_QUEUE, async () => {
    await runCs2CatalogSync(autopilot);
  });
  // The next series' start time is fresh without waiting up to a minute.
  autopilot.onSeriesEnded(() => {
    void boss.send(CATALOG_SYNC_QUEUE, {}).catch((err: unknown) => logger.error({ err }, "cs2: failed to queue a catalog sync"));
  });
}
