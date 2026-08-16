# CS2 GRID data assumptions — tracked for re-verification

Most of what the CS2 implementation (`apps/api/src/cs2/`, `spec_v2.md`) knows about GRID's
`seriesState` feed behavior is derived from two recorded sources so far:
- `cs2/__fixtures__/cs2-series-28-map1.json` (committed fixture, 331 snapshots, GRID-TEST server,
  format looks like MR15 even though production is confirmed MR12).
- Series 2985953 map 1 (Inner Circle Prospects vs ENCE Prospect, European Pro League S6, a real
  production match), 128 docs exported ad hoc from Mongo and cross-checked with `parseSnapshot`/
  `isRoundLive` — not committed as a fixture file, just used for one-off verification so far.

Step 2 of this migration already reversed one conclusion after re-analyzing the first fixture more
carefully, and comparing these two sources directly disproved another assumption outright (#13) —
a strong signal that findings here need explicit, revisitable tracking rather than one-and-done
trust, even once a second data point exists.

As more series get recorded via `GridRecorder` (`apps/api/src/grid/recorder.ts`,
`pnpm grid:record:dev`), re-check each row below against the new data and update its status.
Prefer disproving an assumption over reconfirming it — that's where the real risk is.

**Status values:** `not verified` / `confirmed on N series` / `disproven` (with a note on what
replaced it).

| # | Assumption | Basis | Risk if wrong | Status |
|---|---|---|---|---|
| 1 | Freezetime is observable — at least one snapshot lands strictly between a round's score-change and the next round's clock reset, on every round boundary | 29/29 boundaries in fixture 1; 13/13 in series 2985953 map 1 (14 resets vs 13 score boundaries — same "+1" offset as fixture 1, from Round 1's own warmup→live reset having no preceding round to close out) | Round Lock detection (round-tracker.ts's `isRoundLive`) misses transitions | confirmed on 2 series |
| 2 | `currentSeconds` jumping up by >30s (with `ticking: true`) reliably marks "a new round just went live", with no false positives | 30/30 transitions, fixture 1; 14/14, series 2985953 map 1 — zero false positives both times | False/missed round locks; untested against timeouts, technical pauses, admin restarts | confirmed on 2 series |
| 3 | `paused: true` means either initial warmup or a halftime-style break, not something else | 2 occurrences, 1 fixture | Misinterpreted pauses could look like round transitions or vice versa | not verified |
| 4 | Production format is MR12 → fixed pistol question at Round 13, fixed OT-score question at Round 24 | User confirmation; the recorded fixture itself looks like MR15 | Fixed-round questions (question-provider.ts) fire on the wrong round number | not verified against a real MR12 series |
| 5 | A snapshot carrying the final round's score reaches the poller before `finished: true` removes the game from the GraphQL response (spec §9 п.2) | Not verified — the recorder's "write the closing transition frame" fix (grid/recorder.ts) was only just made | The last round of a map never gets a `cs2_round_end` — round-engine.ts's match-end fallback (diff against `lastLiveSnapshot`) becomes load-bearing instead of a rare edge case | not verified |
| 6 | Match Live Detected fires normally for Match 2/3 within a Series, the same way it does for Match 1 (spec §9 п.1) | Indirect: series 2985958 produced two separate recorded collections (one per map) | Arena #k+1 (step 4, Series lifecycle) never gets created for later maps | confirmed for the normal case (2985958, 2 maps both went live normally); **confirmed-false for a forfeit** — see #12 below |
| 7 | OT play (rounds 25+) is structurally ordinary — score reaches 12-12, then continues as normal catalog rounds, no special end-of-map behavior beyond the score threshold | 1 fixture, and that fixture is not MR12 | OT round handling (question-provider.ts's Round 24 special-case, settle.ts's `ot_score`) could be wrong for the real format | not verified |
| 8 | `teams[0]` is a stable index for "home", `teams[1]` for "away", consistent snapshot-to-snapshot within one map | Convention adopted in settle.ts; GRID has no inherent home/away concept | Every team-targeted question (round_winner, team_ace, multikill, survivors_team) could resolve mirrored | confirmed on 2 series (within-map stability only — `teams[0].name` never changed across 127 live snapshots in series 2985953 map 1 either). Still not cross-checked against an external scoreboard to confirm which *physical* side occupies index 0 |
| 9 | `weaponName` string values match the whitelist exactly (`awp`, `ak47`, `usp_silencer`, `deagle`, `molotov`, `glock`, `tec9`, `hegrenade`) | 1 fixture | `weapon_kill` questions silently always settle "no" if GRID's naming differs (e.g. casing, `usp-s` vs `usp_silencer`) | confirmed on 2 series for the 7 whitelist weapons that appeared (`hegrenade` still unseen — inconclusive, not disproven). Also found 5 real, correctly-spelled weapon names GRID reports that we deliberately don't ask about: `elite`, `galilar`, `m4a1`, `m4a1_silencer`, `mp9` — not a bug, just a note for a future whitelist-expansion decision |
| 10 | `players[]` always has exactly 5 entries per team, and each player's `id` stays stable across all snapshots of one map | 1 fixture | `team_ace`/`multikill` settlement (killDeltas matches by id) silently drops players whose id changes mid-map, or miscounts a roster with != 5 | confirmed on 2 series (series 2985953 map 1: exactly 5 distinct ids per team across all 127 live snapshots) |
| 11 | Base YES-probability per catalog topic (spec §10 difficulty calibration) | No data yet — this is what step 6 exists to collect | Round difficulty stays uncalibrated (uniform random pick, no weighting) | not verified — needs ≥2-3 full recorded series |
| 12 | A forfeited map (technical loss, e.g. a team late to Match 2/3) never produces a `games[]` entry at all — no warmup, no Match Live Detected, nothing per-map to poll. The forfeit only ever surfaces as a discontinuous jump in the **series-level** envelope: `teams[].score` jumps by more than one increment (here `1→2`, skipping the normal "win the next map" step), `finished` flips to `true`, the winning team's `won` flips to `true` — and this update lags the map it "replaces" by some real delay (~2 min observed here), not instantaneous | 1 series (2985953: ICP vs ENCE, EPL S6 — ICP won map 1 ~13-1, ENCE forfeited map 2, confirmed via GRID request/response logs the user captured directly, since the poller itself wasn't running against this series at the time) | Series-lifecycle code (step 4) that only watches per-map `hasLiveGame()`/`games[]` will never notice a forfeit — it needs to also poll the top-level `seriesState.teams[].score`/`finished`/`won` fields directly | confirmed on 1 series |
| 13 | The gap between Match Live Detected (first live snapshot) and Round 1's own lock (clock reset) is a fixed, generous window (spec §7 п.1 implicitly assumes this — "Round 1 opens at MLD", framed as if that gives comfortable answer time) | 2 series, wildly different results: fixture 1 (test server) showed a ~2m40s gap with 12 visible `paused:true` warmup polls; series 2985953 map 1 (real match) showed only **~10 seconds** — one poll interval — with **zero** `paused:true` polls observed at all. The poller had almost certainly been running well before this (recorder started ahead of the 13:35Z scheduled time), so this isn't a "we joined late" artifact — GRID itself didn't expose the game object until freezetime was already nearly over | **disproven as stated** — the gap is not reliably generous. In the worst observed case, Round 1's real answer window could be as short as a single 10s poll interval, not the multi-minute window spec §7 п.1 seems to assume. Affects step 4 UX planning (push notification timing, spec §6) and possibly argues for a minimum synthetic answer window for Round 1 specifically, unlike every other round | disproven on 1 of 2 series — the "generous window" case is now the outlier, not the default; needs a 3rd data point to tell which is actually typical |

## Design gaps surfaced by real data

Not "assumptions to re-verify" so much as gaps in `spec_v2.md` §4 that real data (not analysis)
exposed — flag these when step 4 (Series + Arena lifecycle) gets planned:

- **Arena #k+1 forfeit-cancellation gap.** Arena #k+1 is created *reactively* the instant Match k
  ends (`hasLiveGame()===false` for map k). But per #12 above, when the *next* map is forfeited,
  the series-level "decided" signal (`teams[].score` reaching `winsNeeded`, or `finished:true`)
  can lag map k's own end by real minutes. Concretely, in the 2985953 case: map 1 ended (games
  emptied) at `14:35:26`, but the series didn't show `finished:true`/`score:[2,0]` until
  `14:37:21` — a ~2 minute gap. Under the current spec, Arena #k+1 would already be open (in
  `lobby`, join allowed) during that gap, waiting for a Match Live Detected that will never come.
  spec §4 п.4's no-show/60-min timeout is written only for **Arena #1** ("No-show на першому
  Match у Series") — there's no equivalent rule for Arena #2+. Needs: either (a) extend that
  timeout rule to any Arena #k+1, or (b) have the Series-lifecycle poller watch top-level
  `seriesState` continuously and cancel/refund Arena #k+1 immediately once the Series is observed
  decided while that Arena is still in `lobby` — (b) is tighter (a 2-minute gap, not 60), and
  directly uses the #12 finding instead of just falling back to a timeout.

- **Round 1 answer-window fix (from #13).** Per #13, the gap between Match Live Detected and
  Round 1's own lock is not reliably generous — it can be as short as one poll interval (~10s).
  The *lock* itself must stay pinned to the real clock reset (spec §2 integrity: locking any
  later would let players act on live game state). The fix is on the *open* side instead: open
  `Q(R1)` at Arena creation (lobby start, spec §4 п.1 — up to 10 min before
  `scheduledStartTime`), not at Match Live Detected as currently implemented
  (`Cs2RoundEngine.onMatchLiveDetected()`). Round 1's question content doesn't depend on live
  match state (`pickCs2Candidate()` needs no snapshot), so nothing blocks opening it early.
  Consequence: `onMatchLiveDetected()` stops being the thing that opens Round 1 — Round 1 opens
  from the lobby-creation code path instead, and MLD's remaining job is purely the join-gate
  (spec §5) and letting the lock-cascade begin normally via `cs2_round_lock`. Trade-off: Round
  1's answer window becomes asymmetrically longer than every other round's (potentially 10+
  minutes vs. the ~60-100s typical of rounds 2+) — consistent with spec §6 ("no minimum/fixed
  window for CS2 by design"), just unusual, and worth flagging in step 4's plan rather than
  treating as an oversight.

- **[FIXED] CS2 never surfaces "awaiting result" for a locked-but-unsettled round (found in
  manual live testing, series 2991032, 2026-08-12).** `Cs2RoundEngine` opens Round N+1's question
  the instant Round N locks (`round-engine.ts`'s `handleRoundLock` → `handleOpen(roundNumber + 1,
  ...)`) — intentional cascading generation, by design N can be `locked` (answered, awaiting
  `cs2_round_end`) while N+1 is already `open`. `Cs2ArenaRuntime` never implemented
  `pendingPredictionsFor` and never sent `player.pending`, so a player who answered Round N had no
  way to see that answer was still in flight once Round N+1 replaced it on screen.
  Fixed: `PendingPrediction` (`packages/contracts/src/ws.ts`) now uses the same
  discipline-tagged-optional-fields pattern `PredictionRound` already uses —
  `windowStartMinute?`/`windowEndMinute?` (soccer only) plus a new `roundNumber?: number` (CS2
  only), no discriminated union. `Cs2ArenaRuntime.pendingPredictionsFor` mirrors soccer's
  (`gateway/arena-runtime.ts`) — eliminated players get `[]`, otherwise every `locked` round the
  user answered, sorted by `roundNumber`, pushed via `player.pending` on lock and settle
  (`pushPendingForAnswerers`). `PendingPredictionsList.tsx` is now shared as-is between
  disciplines — its subtitle picks whichever field pair is present — and rendered from
  `Cs2ArenaScreen.tsx` the same way `screens/ArenaScreen.tsx` already does for soccer. Test:
  `cs2/__tests__/arena-runtime.test.ts` — "pendingPredictionsFor: shows a locked-but-unsettled
  round...".

- **[FIXED] Reload/reconnect can strand the client on "Waiting for round" with no vote possible
  (found in manual live testing, series 2991032, 2026-08-12).** Not CS2-specific — the same bug
  existed in both `apps/web/src/cs2/live/useCs2ArenaSocket.ts` and soccer's
  `apps/web/src/arena/live/useArenaSocket.ts`, just far more likely to bite CS2 given its ~60-100s
  round cadence vs. soccer's 5-min windows. Two compounding causes:
  1. `initialView(d)` in both hooks built the view from the REST snapshot
     (`fetchCs2ArenaDetail`/`fetchArenaDetail`) but never read `d.currentRound`, even though
     `ArenaDetailResponse.currentRound` (`packages/contracts/src/dto.ts`) already carries it —
     `gateway/rest.ts`'s `GET /arenas/:id` populates it from `runtime.currentRound` generically,
     for exactly this reconnect case.
  2. The WS resync path (`gateway/ws.ts`'s per-arena `ArenaCache`, replayed to a socket on
     `subscribe`, spec §9) races the REST fetch: both hooks' `ws.onmessage` does
     `setView((v) => (v ? reduce(v, msg, ...) : v))` — if the resync message (`round.open`/
     `round.lock`/...) arrives while `view` is still `null` (REST not yet resolved), it's silently
     dropped, no requeue. The client then has no `round` until the next real live transition
     broadcasts, which for CS2 can still be a while and for soccer up to ~5 min.
  Fixed: `round` is now seeded directly from `d.currentRound` in `initialView()` (both hooks) —
  this alone neutralizes the WS race for the round display, since `view.round` is already correct
  from REST by the time any resync message would apply on top of it. `PredictionRound` carries no
  `lockAt`, so soccer's `RoundView.lockAt` became optional (`useCountdown`/`PredictionCard` now
  treat "unknown lockAt" as no countdown shown, not locked, until a live `round.open`/`round.lock`
  supplies a real one). The underlying WS-vs-REST race itself is left as-is (other resync fields —
  `leaderboard`, soccer's `matchState` — could theoretically hit the same drop, not yet confirmed
  as user-visible in practice). Also newly noted, out of scope here: `myAnswer` for the seeded
  round is never restored on reload (neither `PredictionRound` nor `ArenaDetailResponse` carries a
  per-user answer) — the locked case is covered by the `pendingPredictionsFor` fix below, but an
  *open* round's own prior answer still resets to unpicked on reload, in both disciplines.

- **[FIXED] Leftover open/locked rounds keep running after the Arena already has a declared
  winner (found in manual live testing, series 2991032, 2026-08-12).** `Cs2ArenaRuntime` could
  declare a winner (`this.winners` set via `LeaderboardService`'s "exactly one survivor" path,
  `flushFinishIfPending()`) well before the real CS2 match physically ends (`cs2_match_end`) —
  elimination can narrow the field to one player many rounds before the map itself finishes. But
  `Cs2RoundEngine.isArenaFinished()` (`round-engine.ts`) was only consulted in `handleRoundLock`,
  to decide whether to open the *next* round — it never touched a round that was already
  `open`/`locked` at the moment the winner got declared (there's normally exactly one, per the
  cascading-generation overlap: Round N+1 opens the instant Round N locks). That already-open
  round would keep living its ordinary lock → settle lifecycle off subsequent real GRID signals,
  unaware the Arena was already decided, until the map's actual `cs2_match_end` finally triggered
  `handleMatchEnd()`'s void-pass — which could be many real rounds later.
  Fixed: `Cs2RoundEngine.voidRemaining()` (extracted from `handleMatchEnd`'s existing void-pass,
  no timestamp needed — voided rounds don't carry one) is now also called from
  `Cs2ArenaRuntime.flushFinishIfPending()` right after `this.winners` is set via the
  single-survivor path, before `arena.finished` broadcasts. No-op on the `cs2_match_end` path —
  `handleMatchEnd()` already cleaned up there. Test:
  `cs2/__tests__/arena-runtime.test.ts` — "voids the already-open next round the instant a winner
  is decided...".

- **[FIXED] A player already eliminated can still see "Survived" on a later round they'd
  pre-answered (found in manual live testing, series 2991032, 2026-08-12).** Independent of the
  leftover-round issue above — reproduces on *any* normal elimination, not just the
  winner-deciding round. `Cs2RoundCard.tsx`'s settled-round badge computed `picked ===
  round.correctAnswer ? "Survived" : "Eliminated"` purely from the round's own local answer
  comparison — it ignored the `eliminated` prop (`view.myStatus`, the server-authoritative
  status). Because Round N+1 opens before Round N settles (cascading generation, same overlap as
  the `pendingPredictionsFor` gap above), a player could answer N+1 correctly while still active,
  then get eliminated by Round N's own settle — and when N+1 later settled, the badge still read
  "Survived" from the stale local comparison, contradicting the `player.status: eliminated` push
  that already arrived.
  Fixed: the badge condition is now `!eliminated && picked === round.correctAnswer`, and the
  whole personal-result block is gated on `participant` (a spectator has no `picked` of their own
  to show a result for).

- **[FIXED] The match feed (elimination/settle history) never survives a reload — related to, but
  not fixed by, the "Waiting for round" gap above (found in manual live testing, series 2991032,
  2026-08-12).** Not CS2-specific — same pattern in soccer. `feed` in both
  `useCs2ArenaSocket.ts`/`useArenaSocket.ts` is a purely client-side array built by `reduce()` off
  live WS messages, capped at 20 via `prepend(...).slice(0, 20)`; `initialView()` always started
  `feed: []`.
  Turned out **no new source of truth was needed**: `GET /arenas/:id/rounds`
  (`gateway/rest.ts`, `ArenaRoundsResponse`) already persists the full round history in Postgres,
  each round with its `Prediction[]` (settled rounds only, spec §8) — CS2's gateway serves the
  same route, and `Cs2ArenaRuntime` already calls `persistence.upsertRound` on every transition,
  so the data was already there. The frontend just never called the endpoint.
  Fixed: `prediction-round.repository.ts`'s `listByArenaId` now sorts by `windowStartMinute` then
  `roundNumber` (it previously sorted by `windowStartMinute` alone, which left CS2 rows — always
  `NULL` there — in undefined order). New `fetchArenaRounds`/`fetchCs2ArenaRounds` client calls,
  and a shared `arena/feedFromRounds.ts` helper that reconstructs `FeedItem[]` from
  `RoundWithPredictions[]` — same `id` scheme as `reduce()`'s live-built items
  (`settle-${roundId}`, `void-${roundId}`) so a live message that lands after this seed dedupes
  against it (`prepend()` in both hooks now filters by `id` before prepending) instead of
  doubling up. Also restores personal "You survived"/"You were eliminated" feed entries, which
  the earlier `ArenaCache`-buffer proposal couldn't have (those are addressed per-socket, never
  broadcast).
  Still not covered: a player's own answer to the *current* (not yet settled) round doesn't
  survive reload — the endpoint deliberately omits predictions for open/locked rounds (privacy).
  The locked case is covered by `pendingPredictionsFor`; an *open* round's own prior pick still
  resets to unpicked, same gap noted above.

## How to re-check

A throwaway (not committed) `tsx` script pointed at a newly-recorded Mongo collection, running
its entries through `parseSnapshot` + `isRoundLive` (same approach used to disprove the original
step-2 finding), covers #1-#3 and #9-#10 mechanically — count round-boundary gaps, count
false-positive resets, dump distinct `weaponName` values, check `players[].id` stability and
count across the whole map. #4-#7 need eyeballing a real production-format (MR12) series once one
gets recorded — check final score behavior, whether Round 13/24 land where expected, and whether
Match 2/3 in a Series produce their own Match Live Detected. #8 needs one map where the team
names/scores are cross-checked against an external source (e.g. the tournament's own scoreboard)
to confirm which physical side occupies which array index throughout. #11 accumulates naturally
as more series get recorded — see the plan file for step 6.
