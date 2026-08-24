// The persistence "glue" for cs2/series-lifecycle.ts (cs2-migration-spec/spec_v2.md §4): turns
// the pure reducer's `Cs2LifecycleAction[]` into real Match/Arena/EntryPass rows and running
// `Cs2ArenaRuntime` instances. No live GRID driver yet — `poll()` is called by whatever produces
// a `Cs2SeriesSnapshot` (a live poller later, step 5; a synthetic sequence in tests today), so
// this class is honestly exercised end-to-end against Postgres without one.
//
// Deliberately does nothing for the reducer's `match_ended` action: that's the series-level view
// of a map ending, detected independently from the per-map view `round-tracker.ts`'s
// `trackCs2Poll` already drives Cs2RoundEngine with (`cs2_match_end` on its own bus). Both watch
// the same raw GRID poll through two different parsers (`parseSnapshot` vs `parseSeriesSnapshot`)
// — a production driver feeds one raw response into both pipelines every poll. Acting on
// `match_ended` here too would just be a redundant, potentially out-of-order second trigger for
// something Cs2RoundEngine already owns.

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
  /** Called once an Arena runtime is ready in this process, including a restored lobby. */
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
      throw new Error(`Active CS2 series ${this.series.id} has a cancelled latest arena`);
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
   * The bus for the most recently opened Arena (highest matchIndex) — cs2/live-poller.ts routes
   * round-tracker.ts's per-map signals here. Since Arenas within a Series are strictly
   * sequential, "most recently opened" is always "the one whose map is currently live or about
   * to be" — the map that just ended (a poll's per-map cs2_match_end) is still the highest
   * matchIndex *until* this same poll's series-level action opens the next one, which is why
   * live-poller.ts reads this before calling `poll()`, not after.
   */
  currentBus(): MatchSignalBus | undefined {
    const indices = [...this.arenasByMatchIndex.keys()];
    if (indices.length === 0) return undefined;
    return this.arenasByMatchIndex.get(Math.max(...indices))?.bus;
  }

  async poll(snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    if (this.reconcilingFinishedMatch && snapshot?.hasLiveGame === true) {
      throw new Error(`Cannot safely restore active CS2 series ${this.series.id}: its next map is already live`);
    }
    const { state, actions } = processCs2SeriesPoll(this.lifecycleState, snapshot, now);
    this.lifecycleState = state;
    // Sequential, in action order — matters for the rare same-poll "open Arena #1 then
    // immediately no-show-cancel it" case (series-lifecycle.ts's own doc comment).
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
        return; // see file header — Cs2RoundEngine owns this via its own bus signal
      case "series_decided":
        await seriesRepository.setStatus(this.series.id, "decided");
        return;
      case "cancel_arena":
        await this.cancelArena(action.matchIndex, action.reason);
        return;
    }
  }

  private async openArena(matchIndex: number, snapshot: Cs2SeriesSnapshot | undefined, now: IsoDateTime): Promise<void> {
    const teamNames = snapshot ? { home: snapshot.teams[0].name, away: snapshot.teams[1].name } : undefined;
    const match = await matchRepository.upsertForSeriesMap(this.series.id, matchIndex, {
      homeTeam: teamNames?.home ?? "Home",
      awayTeam: teamNames?.away ?? "Away",
      startTime: new Date(now),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, {
      entryFeeLamports: this.options.entryFeeLamports,
      prizePoolLamports: 0,
    });

    const opened = await this.createRuntime(match, arena, [], false);
    this.arenasByMatchIndex.set(matchIndex, opened);
    this.options.onArenaOpened?.(arena.id, opened.runtime);
    opened.runtime.openRoundOne(now);
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
          // Off-chain arenas (never provisioned on-chain — every CS2 arena today) make this a
          // safe no-op; kept for parity with soccer's gateway/run.ts and to start working the
          // moment CS2 arenas do get provisioned.
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
      teamNames: { home: match.homeTeam, away: match.awayTeam },
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
    const opened = this.arenasByMatchIndex.get(matchIndex);
    if (opened === undefined) return;

    await closeEntrySubmissions(opened.arenaId);
    const cancelled = await arenaRepository.cancelIfLobby(opened.arenaId, reason);
    if (cancelled === undefined) return; // already left lobby — nothing to cancel

    if (reason === "no_show") await seriesRepository.setStatus(this.series.id, "invalid");

    const passes = await entryPassRepository.listByArenaId(opened.arenaId);
    for (const pass of passes) await entryPassRepository.markRefunded(pass.id);

    this.options.broadcaster?.broadcast(opened.arenaId, { type: "arena.cancelled", reason });
  }
}
