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
import { arenaRepository } from "../db/repositories/arena.repository.js";
import { entryPassRepository } from "../db/repositories/entry-pass.repository.js";
import { matchRepository } from "../db/repositories/match.repository.js";
import { predictionRoundRepository } from "../db/repositories/prediction-round.repository.js";
import { seriesRepository } from "../db/repositories/series.repository.js";
import type { IsoDateTime, Series, Uuid } from "@arena/contracts";
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

  constructor(
    private readonly series: Series,
    private readonly options: Cs2SeriesOrchestratorOptions,
  ) {
    this.lifecycleState = initialCs2SeriesLifecycleState(series.scheduledStartTime);
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
    const { state, actions } = processCs2SeriesPoll(this.lifecycleState, snapshot, now);
    this.lifecycleState = state;
    // Sequential, in action order — matters for the rare same-poll "open Arena #1 then
    // immediately no-show-cancel it" case (series-lifecycle.ts's own doc comment).
    for (const action of actions) await this.apply(action, snapshot, now);
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
    const match = await matchRepository.createForSeriesMap(this.series.id, {
      homeTeam: teamNames?.home ?? "Home",
      awayTeam: teamNames?.away ?? "Away",
      startTime: new Date(now),
    });
    const arena = await arenaRepository.upsertForMatch(match.id, {
      entryFeeLamports: this.options.entryFeeLamports,
      prizePoolLamports: 0,
    });

    const bus = new MatchSignalBus();
    const predictionStore = createPgPredictionStore(arena.id, this.options.writeQueue);
    const arenaPlayerStore = createPgArenaPlayerStore(arena.id, this.options.writeQueue);
    const persistence: Cs2ArenaPersistence = {
      upsertRound: (round) => {
        void this.options.writeQueue.enqueue(arena.id, () => predictionRoundRepository.upsert(round).then(() => undefined));
      },
      finishArena: (arenaId, _winners) => {
        void this.options.writeQueue.enqueue(arenaId, () => arenaRepository.setStatus(arenaId, "finished"));
      },
    };

    const runtime = new Cs2ArenaRuntime({
      matchId: match.id,
      arenaId: arena.id,
      bus,
      predictionStore,
      arenaPlayerStore,
      roster: [],
      persistence,
      ...(this.options.broadcaster !== undefined ? { broadcaster: this.options.broadcaster } : {}),
      ...(teamNames !== undefined ? { teamNames } : {}),
    });

    this.arenasByMatchIndex.set(matchIndex, { matchId: match.id, arenaId: arena.id, runtime, bus });
    runtime.openRoundOne(now);
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
