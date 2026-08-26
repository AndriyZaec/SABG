import type { GatewayBroadcaster } from "../gateway/arena-runtime.js";
import { closeEntrySubmissions } from "../gateway/entry-prepare-store.js";
import { createPgArenaPlayerStore } from "../gateway/stores/pg-arena-player-store.js";
import { createPgPredictionStore } from "../gateway/stores/pg-prediction-store.js";
import type { WriteQueue } from "../gateway/stores/write-queue.js";
import { MatchSignalBus } from "../ingestion/event-bus.js";
import { arenaPlayerRepository } from "../db/repositories/arena-player.repository.js";
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { predictionRepository } from "../db/repositories/prediction.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import { userRepository } from "../db/repositories/user.repository.js";
import {
  cancelArenaOnchain,
  listOnchainArenaEntryPlayers,
  refundArenaEntryOnchain,
} from "../onchain/index.js";
import { payoutService } from "../payout/index.js";
import type { Arena, IsoDateTime, Match, PredictionRound, Series, Uuid } from "@arena/contracts";
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
}

interface OpenedArena {
  matchId: Uuid;
  arenaId: Uuid;
  runtime: Cs2ArenaRuntime;
  bus: MatchSignalBus;
}

export class Cs2SeriesOrchestrator {
  private lifecycleState: Cs2SeriesLifecycleState;
  private readonly arenasByMatchIndex = new Map<number, OpenedArena>();
  private reconcilingFinishedMatch = false;
  private pendingCancellation: { matchIndex: number; reason: "no_show" | "series_decided" } | undefined;

  constructor(
    private readonly series: Series,
    private readonly options: Cs2SeriesOrchestratorOptions,
  ) {
    this.lifecycleState = {
      ...initialCs2SeriesLifecycleState(series.scheduledStartTime),
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
    await matchRepository.ensureSeriesMatchIndexes(this.series.id);
    const existingMatches = await matchRepository.listBySeriesId(this.series.id);
    if (existingMatches.length === 0) return;
    if (existingMatches.some((match) => match.seriesMatchIndex === undefined)) {
      throw new Error(`Series ${this.series.id} has CS2 matches without a series match index`);
    }

    const latestMatch = existingMatches[existingMatches.length - 1]!;
    const matchIndex = latestMatch.seriesMatchIndex!;
    if (this.series.status !== "active") {
      this.lifecycleState = { ...this.lifecycleState, openedThrough: matchIndex };
      const terminalArena = await arenaRepository.findByMatchId(latestMatch.id);
      if (terminalArena?.status === "cancelled") await this.refundCancelledArena(terminalArena);
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
      matchLiveDetected: matchWasLive,
      lastHasLiveGame: matchWasLive,
    };

    if (arena.status === "live") {
      throw new Error(`Cannot safely restore live CS2 arena ${arena.id} without a GRID lock snapshot`);
    }
    if (arena.status === "cancelled") {
      await this.refundCancelledArena(arena);
      if (arena.cancelledReason === "no_show") {
        await seriesRepository.setStatus(this.series.id, "invalid");
        this.lifecycleState = { ...this.lifecycleState, invalid: true };
      } else {
        await seriesRepository.setStatus(this.series.id, "decided");
        this.lifecycleState = { ...this.lifecycleState, decided: true };
      }
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

  /** Must be read before a poll can open the next arena. */
  currentBus(): MatchSignalBus | undefined {
    const indices = [...this.arenasByMatchIndex.keys()];
    if (indices.length === 0) return undefined;
    return this.arenasByMatchIndex.get(Math.max(...indices))?.bus;
  }

  async poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    if (this.pendingCancellation !== undefined) {
      await this.cancelArena(this.pendingCancellation.matchIndex, this.pendingCancellation.reason);
      return;
    }
    if (this.reconcilingFinishedMatch && snapshot?.hasLiveGame === true) {
      throw new Error(`Cannot safely restore active CS2 series ${this.series.id}: its next map is already live`);
    }
    const { state, actions } = processCs2SeriesPoll(this.lifecycleState, snapshot, now);
    this.lifecycleState = state;
    // Preserve reducer action order when one poll emits multiple transitions.
    for (const action of actions) await this.apply(action, snapshot, now);
    if (snapshot !== undefined) this.reconcilingFinishedMatch = false;
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
    if (snapshot === undefined) throw new Error(`Cannot open CS2 Arena ${matchIndex} without team identities`);
    const [firstTeam, secondTeam] = snapshot.teams;
    const match = await matchRepository.upsertForSeriesMap(this.series.id, matchIndex, {
      homeTeam: firstTeam.name,
      awayTeam: secondTeam.name,
      startTime: new Date(now),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, {
      entryFeeLamports: this.options.entryFeeLamports,
      prizePoolLamports: 0,
    });

    const opened = await this.createRuntime(match, arena, [], false);
    this.arenasByMatchIndex.set(matchIndex, opened);
    this.options.onArenaOpened?.(arena.id, opened.runtime);
    opened.runtime.openRoundOne(now, snapshot.teams);
  }

  private async createRuntime(
    match: Match,
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
          await arenaRepository.setStatus(arenaId, "finished");
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
      initialRounds,
      ...(this.options.broadcaster !== undefined ? { broadcaster: this.options.broadcaster } : {}),
    });

    return { matchId: match.id, arenaId: arena.id, runtime, bus };
  }

  private async matchLiveDetected(matchIndex: number, now: IsoDateTime): Promise<void> {
    const opened = this.arenasByMatchIndex.get(matchIndex);
    if (opened === undefined) return;
    opened.runtime.onMatchLiveDetected(now);
    await closeEntrySubmissions(opened.arenaId);
    await arenaRepository.setStatus(opened.arenaId, "live");
  }

  private async cancelArena(matchIndex: number, reason: "no_show" | "series_decided"): Promise<void> {
    this.pendingCancellation = { matchIndex, reason };
    const opened = this.arenasByMatchIndex.get(matchIndex);
    if (opened === undefined) throw new Error(`Cannot cancel unopened CS2 arena #${matchIndex}`);

    await closeEntrySubmissions(opened.arenaId);
    const current = await arenaRepository.findById(opened.arenaId);
    if (current?.status === "cancelled") {
      await this.refundCancelledArena(current);
      await seriesRepository.setStatus(this.series.id, reason === "no_show" ? "invalid" : "decided");
      this.options.broadcaster?.broadcast(opened.arenaId, { type: "arena.cancelled", reason });
      this.pendingCancellation = undefined;
      return;
    }
    if (current?.status !== "lobby") {
      throw new Error(`Cannot cancel arena ${opened.arenaId} from state ${current?.status ?? "missing"}`);
    }
    if (current.onchainArenaId !== undefined) await cancelArenaOnchain(current.onchainArenaId);

    const cancelled = await arenaRepository.cancelIfLobby(opened.arenaId, reason);
    if (cancelled === undefined) {
      throw new Error(`Arena ${opened.arenaId} changed state after its on-chain cancellation`);
    }

    await seriesRepository.setStatus(this.series.id, reason === "no_show" ? "invalid" : "decided");
    await this.refundCancelledArena(cancelled);

    this.options.broadcaster?.broadcast(opened.arenaId, { type: "arena.cancelled", reason });
    this.pendingCancellation = undefined;
  }

  private async refundCancelledArena(arena: Arena): Promise<void> {
    if (arena.onchainArenaId !== undefined) await cancelArenaOnchain(arena.onchainArenaId);
    const passes = await entryPassRepository.listByArenaId(arena.id);
    const passByWallet = new Map(passes.map((pass) => [pass.walletAddress, pass]));
    const wallets = new Set(passByWallet.keys());
    if (arena.onchainArenaId !== undefined) {
      for (const wallet of await listOnchainArenaEntryPlayers(arena.onchainArenaId)) wallets.add(wallet);
    }

    let firstFailure: unknown;
    for (const wallet of wallets) {
      try {
        if (arena.onchainArenaId !== undefined) {
          await refundArenaEntryOnchain(arena.onchainArenaId, wallet);
        }
        const pass = passByWallet.get(wallet);
        if (pass !== undefined && pass.status !== "refunded") await entryPassRepository.markRefunded(pass.id);
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
    await arenaRepository.clearCancelledBalances(arena.id);
  }
}
