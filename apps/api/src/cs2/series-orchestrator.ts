import type { GatewayBroadcaster } from "../gateway/arena-runtime.js";
import { closeEntrySubmissions } from "../gateway/entry-prepare-store.js";
import { createPgArenaPlayerStore } from "../gateway/stores/pg-arena-player-store.js";
import { createPgPredictionStore } from "../gateway/stores/pg-prediction-store.js";
import type { WriteQueue } from "../gateway/stores/write-queue.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { arenaPlayerRepository } from "../db/repositories/arena-player.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { cs2SeriesFollowRepository } from "../db/repositories/cs2-series-follow.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { predictionRepository } from "../db/repositories/prediction.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import { userRepository } from "../db/repositories/user.repository.js";
import { logger } from "../grid/logger.js";

const PUSH_FOLLOWER_BATCH_SIZE = 10;
import { sendPushToUser } from "../push/service.js";
import { cancelArenaOnchain } from "../onchain/index.js";
import { payoutService } from "../payout/index.js";
import type { Arena, Cs2GameSnapshot, Cs2Match, IsoDateTime, PredictionRound, Series, Uuid } from "@arena/contracts";
import { Cs2ArenaRuntime, type Cs2ArenaPersistence } from "./arena-runtime.js";
import {
  initialCs2SeriesLifecycleState,
  processCs2SeriesPoll,
  type Cs2LifecycleAction,
  type Cs2SeriesLifecycleState,
} from "./series-lifecycle.js";
import type { Cs2SeriesSnapshot } from "./series-snapshot.js";

export interface Cs2SeriesOrchestratorOptions {
  writeQueue: WriteQueue;
  entryFeeLamports: number;
  broadcaster?: GatewayBroadcaster;
  onArenaOpened?: (arenaId: Uuid, runtime: Cs2ArenaRuntime) => void;
  /** Join after map 1, which is already live (the 0:0 rule, `decideSeriesEntry`). */
  startAfterMap1?: true;
}

/** The poll can't tell which map it follows after a crash close; the series must be abandoned, not retried. */
export class Cs2SeriesOvertakenError extends Error {}

interface OpenedArena {
  matchId: Uuid;
  arenaId: Uuid;
  runtime: Cs2ArenaRuntime;
  bus: MatchSignalBus;
  /** Set once the arena is cancelled: it gets no more match signals, but stays mapped so its map never reopens. */
  detached: boolean;
}

export class Cs2SeriesOrchestrator {
  private lifecycleState: Cs2SeriesLifecycleState;
  private readonly arenasByMatchIndex = new Map<number, OpenedArena>();
  private reconcilingFinishedMatch = false;
  /** Set by a crash close until the first snapshot confirms map k is still the one being played. */
  private reconcilingCrashClosedMatch = false;

  constructor(
    private readonly series: Series,
    private readonly options: Cs2SeriesOrchestratorOptions,
  ) {
    this.lifecycleState = {
      ...initialCs2SeriesLifecycleState(
        series.scheduledStartTime,
        options.startAfterMap1 === true ? { startAfterMap1: true } : {},
      ),
      format: series.format,
      decided: series.status === "decided",
      invalid: series.status === "invalid",
    };
  }

  static async create(series: Series, options: Cs2SeriesOrchestratorOptions): Promise<Cs2SeriesOrchestrator> {
    const orchestrator = new Cs2SeriesOrchestrator(series, options);
    await orchestrator.restore();
    return orchestrator;
  }

  private async restore(): Promise<void> {
    const storedMatches = await matchRepository.listBySeriesId(this.series.id);
    if (storedMatches.some((match) => match.discipline !== "cs2")) {
      throw new Error(`Series ${this.series.id} contains a non-CS2 match`);
    }
    const existingMatches = storedMatches.filter((match): match is Cs2Match => match.discipline === "cs2");
    if (existingMatches.length === 0) return;

    const latestMatch = existingMatches[existingMatches.length - 1]!;
    const matchIndex = latestMatch.seriesMatchIndex;
    if (this.series.status !== "active") {
      this.lifecycleState = { ...this.lifecycleState, openedThrough: matchIndex };
      return;
    }

    const arena =
      (await arenaRepository.findByMatchId(latestMatch.id)) ??
      (await arenaRepository.upsertForMatch(latestMatch.id, {
        entryFeeLamports: this.options.entryFeeLamports,
        prizePoolLamports: 0,
      }));

    const matchWasLive = arena.status === "live" || arena.status === "finished";
    this.lifecycleState = {
      ...this.lifecycleState,
      openedThrough: matchIndex,
      openedThroughAt: latestMatch.startTime,
      matchLiveDetected: matchWasLive,
      lastHasLiveGame: matchWasLive,
    };

    if (arena.status === "live") {
      // No runtime: the state above keeps map k live, so its end opens arena k+1 as usual.
      await this.crashCloseLiveArena(arena.id);
      this.reconcilingCrashClosedMatch = true;
      return;
    }
    if (arena.status === "cancelled") {
      if (arena.cancelledReason === "no_show") {
        await seriesRepository.setStatus(this.series.id, "invalid");
        this.lifecycleState = { ...this.lifecycleState, invalid: true };
      } else if (arena.cancelledReason === "series_decided") {
        await seriesRepository.setStatus(this.series.id, "decided");
        this.lifecycleState = { ...this.lifecycleState, decided: true };
      }
      // A forfeit leaves the series active: the next polls re-detect it and open the next arena.
      return;
    }
    if (arena.status === "finished") {
      this.reconcilingFinishedMatch = true;
      return;
    }

    const rounds = await predictionRoundRepository.listByArenaId(arena.id);
    if (rounds.some((round) => round.status !== "open")) {
      throw new Error(`Lobby CS2 arena ${arena.id} contains a non-open round`);
    }
    const opened = await this.createRuntime(latestMatch, arena, rounds, true);
    this.arenasByMatchIndex.set(matchIndex, opened);
    this.options.onArenaOpened?.(arena.id, opened.runtime);
    opened.runtime.openRoundOne(latestMatch.startTime);
  }

  /**
   * A live arena can't resume: settling a locked round needs the in-memory lock snapshot.
   * Unsettled rounds are voided and the still-active players split the pool, as in a tie.
   */
  private async crashCloseLiveArena(arenaId: Uuid): Promise<void> {
    const now = new Date().toISOString();
    const unsettled = (await predictionRoundRepository.listByArenaId(arenaId)).filter(
      (round) => round.status === "open" || round.status === "locked",
    );
    for (const round of unsettled) await predictionRoundRepository.upsert({ ...round, status: "voided", settledAt: now });

    const winnerIds = await arenaPlayerRepository.getActivePlayerIds(arenaId);
    if (winnerIds.length === 0) {
      const passes = await entryPassRepository.listByArenaId(arenaId);
      if (passes.some((pass) => pass.status === "paid")) {
        // A normal game never ends with paid entries and nobody active; leave it to an operator.
        logger.error({ arenaId }, "cs2: live arena at restore has paid entries but no active players; left live");
        return;
      }
    }
    if ((await arenaRepository.setFinishedIfLive(arenaId)) === undefined) {
      logger.warn({ arenaId }, "cs2: live arena at restore is no longer live; not finishing or paying");
      return;
    }
    for (const userId of winnerIds) await arenaPlayerRepository.setStatus(arenaId, userId, "winner");
    await payoutService.settleArena(arenaId, winnerIds);
    logger.info(
      { arenaId, winners: winnerIds.length, voidedRounds: unsettled.length },
      "cs2: crash-closed a live arena on restore",
    );
  }

  openedArenaIds(): Uuid[] {
    return [...this.arenasByMatchIndex.values()].map((opened) => opened.arenaId);
  }

  async isComplete(): Promise<boolean> {
    if (!this.lifecycleState.decided && !this.lifecycleState.invalid) {
      if ((await seriesRepository.findById(this.series.id))?.status === "active") return false;
    }
    for (const arenaId of this.openedArenaIds()) {
      const status = (await arenaRepository.findById(arenaId))?.status;
      if (status === "lobby" || status === "live") return false;
    }
    return true;
  }

  /**
   * Operator stop: skip the series unless its open arena holds a paid entry.
   * The caller stops polling first, so no poll races this.
   */
  async skip(): Promise<"skipped" | "refused"> {
    // The poll that was in flight when polling paused may have ended the series already; don't overwrite that.
    if ((await seriesRepository.findById(this.series.id))?.status !== "active") {
      await seriesRepository.clearSkipRequested(this.series.id);
      return "skipped";
    }

    // From the DB, not memory: restore() leaves a live arena it couldn't close without a runtime.
    const matches = await matchRepository.listBySeriesId(this.series.id);
    const latest = matches[matches.length - 1];
    const matchIndex = latest?.discipline === "cs2" ? latest.seriesMatchIndex : undefined;
    const arena = latest === undefined ? undefined : await arenaRepository.findByMatchId(latest.id);
    const opened = matchIndex === undefined ? undefined : this.arenasByMatchIndex.get(matchIndex);

    if (matchIndex !== undefined && arena !== undefined && (arena.status === "lobby" || arena.status === "live")) {
      const passes = await entryPassRepository.listByArenaId(arena.id);
      if (passes.some((pass) => pass.status === "paid")) {
        await seriesRepository.clearSkipRequested(this.series.id);
        logger.warn({ arenaId: arena.id }, "cs2: operator skip refused, the open arena has paid entries");
        return "refused";
      }
      if (arena.status === "lobby") {
        // A payer racing this check is refunded by the refund job, like any cancelled arena's.
        await this.cancelArena(matchIndex, "operator_skip");
      } else {
        // Entries closed when it went live, so the paid-pass check above can't go stale before this write.
        if ((await arenaRepository.cancelLiveIfEmpty(arena.id, "operator_skip")) === undefined) {
          await seriesRepository.clearSkipRequested(this.series.id);
          logger.warn({ arenaId: arena.id }, "cs2: operator skip refused, the live arena changed or has paid entries");
          return "refused";
        }
        if (opened !== undefined) opened.detached = true;
        // No paid entries, so a failed on-chain cancel leaves only an empty account open.
        if (arena.onchainArenaId !== undefined) {
          await cancelArenaOnchain(arena.onchainArenaId).catch((err: unknown) =>
            logger.error({ err, arenaId: arena.id }, "cs2: on-chain cancel of a skipped live arena failed"),
          );
        }
        this.options.broadcaster?.broadcast(arena.id, { type: "arena.cancelled", reason: "operator_skip" });
      }
    }

    await seriesRepository.setStatus(this.series.id, "skipped");
    await seriesRepository.clearSkipRequested(this.series.id);
    this.lifecycleState = { ...this.lifecycleState, invalid: true };
    logger.info({ seriesId: this.series.id }, "cs2: series skipped by the operator");
    return "skipped";
  }

  /** Must be read before a poll can open the next arena. */
  currentBus(): MatchSignalBus | undefined {
    return this.currentArena()?.bus;
  }

  async updateLiveScore(snapshot: Cs2GameSnapshot): Promise<void> {
    const opened = this.currentArena();
    if (opened === undefined) return;
    await matchRepository.updateCs2TeamScores(opened.matchId, snapshot.teams);
  }

  // The latest map's arena, unless it was detached. An older map's arena would misattribute the signals.
  private currentArena(): OpenedArena | undefined {
    const indices = [...this.arenasByMatchIndex.keys()];
    if (indices.length === 0) return undefined;
    const opened = this.arenasByMatchIndex.get(Math.max(...indices));
    return opened?.detached === true ? undefined : opened;
  }

  async poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    if (this.reconcilingFinishedMatch && snapshot?.hasLiveGame === true) {
      throw new Error(`Cannot safely restore active CS2 series ${this.series.id}: its next map is already live`);
    }
    // Map k ended during the outage and k+1 is live: following it as map k would shift every later arena by one map.
    if (
      this.reconcilingCrashClosedMatch &&
      snapshot?.hasLiveGame === true &&
      snapshot.teams[0].score + snapshot.teams[1].score >= this.lifecycleState.openedThrough
    ) {
      throw new Cs2SeriesOvertakenError(
        `Cannot safely resume CS2 series ${this.series.id}: the map after the crash-closed one is already live`,
      );
    }
    const { state, actions } = processCs2SeriesPoll(this.lifecycleState, snapshot, now);
    // Commit only once every action applied: a failure leaves the old state, so the next poll re-emits them.
    for (const action of actions) await this.apply(action, snapshot, now);
    this.lifecycleState = state;
    if (snapshot !== undefined) {
      this.reconcilingFinishedMatch = false;
      this.reconcilingCrashClosedMatch = false;
    }
    if (snapshot !== undefined && snapshot.mapNames.length > 0) {
      await seriesRepository.setMapNames(this.series.id, snapshot.mapNames);
    }
  }

  private async apply(action: Cs2LifecycleAction, snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    switch (action.type) {
      case "open_arena":
        await this.openArena(action.matchIndex, snapshot, now);
        return;
      case "match_live_detected":
        await this.matchLiveDetected(action.matchIndex, now);
        return;
      case "match_ended":
        await this.markMatchFinished(action.matchIndex);
        return;
      case "series_decided":
        await seriesRepository.setStatus(this.series.id, "decided");
        return;
      case "cancel_arena":
        await this.cancelArena(action.matchIndex, action.reason);
        return;
    }
  }

  private async openArena(matchIndex: number, snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    // A retried poll re-emits open_arena after a later action failed; the arena is already running.
    if (this.arenasByMatchIndex.has(matchIndex)) return;
    if (snapshot === undefined) throw new Error(`Cannot open CS2 Arena ${matchIndex} without team identities`);
    const match = await matchRepository.upsertForSeriesMap(this.series.id, matchIndex, {
      teams: snapshot.teams,
      startTime: new Date(now),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, {
      entryFeeLamports: this.options.entryFeeLamports,
      prizePoolLamports: 0,
    });
    await seriesRepository.setCatalogLifecycle(this.series.id, "live");

    const opened = await this.createRuntime(match, arena, [], false);
    this.arenasByMatchIndex.set(matchIndex, opened);
    this.options.onArenaOpened?.(arena.id, opened.runtime);
    opened.runtime.openRoundOne(now, snapshot.teams);
    void this.notifyFollowersOfArenaOpen(arena.id);
  }

  private async notifyFollowersOfArenaOpen(arenaId: Uuid): Promise<void> {
    try {
      const followerUserIds = await cs2SeriesFollowRepository.listFollowerUserIds(this.series.id);
      for (let offset = 0; offset < followerUserIds.length; offset += PUSH_FOLLOWER_BATCH_SIZE) {
        await Promise.all(
          followerUserIds.slice(offset, offset + PUSH_FOLLOWER_BATCH_SIZE).map((userId) =>
            sendPushToUser(userId, {
              title: "Map is live",
              body: "Your CS2 arena just opened — jump in now.",
              url: `/cs2/arena/${arenaId}`,
            }),
          ),
        );
      }
    } catch (err) {
      logger.error({ err, arenaId }, "cs2: failed to notify series followers of arena open");
    }
  }

  private async createRuntime(
    match: Cs2Match,
    arena: Arena,
    initialRounds: PredictionRound[],
    restoring: boolean,
  ): Promise<OpenedArena> {
    const bus = new MatchSignalBus();
    const predictionStore = createPgPredictionStore(arena.id, this.options.writeQueue);
    const arenaPlayerStore = createPgArenaPlayerStore(arena.id, this.options.writeQueue);
    const players = restoring ? await arenaPlayerRepository.list(arena.id) : [];
    arenaPlayerStore.hydrate(players);

    const roster = await Promise.all(
      players.map(async (player) => {
        const user = await userRepository.findById(player.userId);
        if (user === undefined) throw new Error(`Arena player ${player.userId} has no user row`);
        return { userId: player.userId, username: user.username, joinedAt: player.joinedAt };
      }),
    );
    for (const round of initialRounds) {
      predictionStore.hydrate(round.id, await predictionRepository.getAnswers(round.id));
    }

    const persistence: Cs2ArenaPersistence = {
      upsertRound: (round) => {
        void this.options.writeQueue.enqueue(arena.id, () => predictionRoundRepository.upsert(round).then(() => undefined));
      },
      finishArena: (arenaId, winners) => {
        void this.options.writeQueue.enqueue(arenaId, async () => {
          // Pay only after our own live -> finished transition; a cancelled arena must never finish or pay.
          if ((await arenaRepository.setFinishedIfLive(arenaId)) === undefined) {
            logger.warn({ arenaId }, "cs2: match end for an arena that isn't live; not finishing or paying");
            return;
          }
          await payoutService.settleArena(arenaId, winners);
        });
      },
    };

    const runtime = new Cs2ArenaRuntime({
      matchId: match.id,
      arenaId: arena.id,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster,
      persistence,
      teams: match.teamScores.map(({ teamId, name }) => ({ teamId, name })) as [
        { teamId: Uuid; name: string },
        { teamId: Uuid; name: string },
      ],
      initialRounds,
      ...(this.options.broadcaster !== undefined ? { broadcaster: this.options.broadcaster } : {}),
    });

    return { matchId: match.id, arenaId: arena.id, runtime, bus, detached: false };
  }

  private async matchLiveDetected(matchIndex: number, now: IsoDateTime): Promise<void> {
    const opened = this.arenasByMatchIndex.get(matchIndex);
    if (opened === undefined) return;
    await closeEntrySubmissions(opened.arenaId);
    // Throwing keeps the poll uncommitted; once the game ends the reducer re-emits the cancel and it completes.
    if ((await arenaRepository.setLiveIfOpen(opened.arenaId)) === undefined) {
      throw new Error(`Cannot start CS2 arena ${opened.arenaId}: it is no longer open`);
    }
    opened.runtime.onMatchLiveDetected(now);
    await matchRepository.setStatus(opened.matchId, "live");
  }

  private async markMatchFinished(matchIndex: number): Promise<void> {
    // A crash-closed map has no runtime, so fall back to the DB. A startAfterMap1 join has no match for map 1 at all.
    const matchId =
      this.arenasByMatchIndex.get(matchIndex)?.matchId ??
      (await matchRepository.findBySeriesMatchIndex(this.series.id, matchIndex))?.id;
    if (matchId !== undefined) await matchRepository.setStatus(matchId, "finished");
  }

  private async cancelArena(matchIndex: number, reason: "no_show" | "series_decided" | "forfeit" | "operator_skip"): Promise<void> {
    // restore() creates no runtime for an already-cancelled arena, so fall back to the DB.
    const opened = this.arenasByMatchIndex.get(matchIndex);
    const arenaId = opened?.arenaId ?? (await this.findArenaIdByMatchIndex(matchIndex));
    if (arenaId === undefined) throw new Error(`Cannot cancel unopened CS2 arena #${matchIndex}`);

    await closeEntrySubmissions(arenaId);
    const current = await arenaRepository.findById(arenaId);
    if (current?.status === "cancelled") {
      // Kept in the map so openArena never reopens this map.
      if (opened !== undefined) opened.detached = true;
      if (reason === "no_show") await seriesRepository.setStatus(this.series.id, "invalid");
      else if (reason === "series_decided") await seriesRepository.setStatus(this.series.id, "decided");
      this.options.broadcaster?.broadcast(arenaId, { type: "arena.cancelled", reason });
      return;
    }
    if (current?.status !== "lobby") {
      throw new Error(`Cannot cancel arena ${arenaId} from state ${current?.status ?? "missing"}`);
    }
    if (current.onchainArenaId !== undefined) await cancelArenaOnchain(current.onchainArenaId);

    const cancelled = await arenaRepository.cancelIfLobby(arenaId, reason);
    if (cancelled === undefined) {
      throw new Error(`Arena ${arenaId} changed state after its on-chain cancellation`);
    }
    if (opened !== undefined) opened.detached = true;

    // Refunds are the scheduled refund job's. If a write below fails, setLiveIfOpen still keeps the arena from going live.
    // A forfeit leaves the series active — it continues to the next map.
    if (reason === "no_show") await seriesRepository.setStatus(this.series.id, "invalid");
    else if (reason === "series_decided") await seriesRepository.setStatus(this.series.id, "decided");

    this.options.broadcaster?.broadcast(arenaId, { type: "arena.cancelled", reason });
  }

  private async findArenaIdByMatchIndex(matchIndex: number): Promise<Uuid | undefined> {
    const match = (await matchRepository.listBySeriesId(this.series.id)).find(
      (m) => m.discipline === "cs2" && m.seriesMatchIndex === matchIndex,
    );
    return match === undefined ? undefined : (await arenaRepository.findByMatchId(match.id))?.id;
  }
}
