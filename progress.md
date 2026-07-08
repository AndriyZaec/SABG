# SABG — Progress

_Snapshot as of 2026-07-10, branch `featute/apis`. Cross-check against `docs/build_plan.md` (source of the block IDs below) before relying on this as current truth — it decays fast._

## Done

**Phase 0 — Foundation**
- P0.1 monorepo (pnpm workspaces: `apps/api`, `apps/web`, `packages/contracts`, `programs/arena`)
- P0.2 `@arena/contracts` — enums, entities, DTOs, WS catalog, settlement DSL (`packages/contracts/src`)
- P0.3 Postgres schema + drizzle migrations (`apps/api/src/db`)
- P0.4 mock server (`apps/api/src/mock`)
- P0.5 Anchor program skeleton — instructions declared, **no business logic** (all bodies are `Ok(())` / TODO), never built (no `target/` dir, IDL not generated yet)
- P0.6 settlement DSL agreed (`packages/contracts/src/settlement.ts`)

**Backend track (V)** — commits `332b2bb`…`162137a`
- B1 TxODDS ingestion + replay (`apps/api/src/ingestion`) — normalizer, whitelist, event bus, fixture replay (`replay.ts`, doubles as B8 seed) + live SSE worker (`apps/api/src/live`)
- B2 Match State Engine (`apps/api/src/match-state`)
- B3 Round Engine (`apps/api/src/round-engine`)
- B4 Settlement Engine (`apps/api/src/settlement`) — pure `(condition, events[]) => result`, early/window-end/idempotency covered
- B5 Question Generator (`apps/api/src/question-generator`) — rule/template based, randomized candidate pick
- B6 Leaderboard Service (`apps/api/src/leaderboard`) — score, tie-breaks, winner resolution
- B7 Realtime Gateway + REST (`apps/api/src/gateway`) — WS + REST, Postgres-backed repositories/mappers, HMAC session auth (`gateway/auth.ts`), demo fixture replay wired end-to-end (`gateway/run.ts`)

**Test coverage**: unit/integration tests exist for db, gateway (5 files), ingestion, leaderboard, match-state, question-generator, round-engine, settlement — 20 test files total under `apps/api/src`. Per CLAUDE.md convention these have not been run as part of this review; run `pnpm -r test` to confirm current pass/fail state.

## Not started / stubbed

**On-chain track (A)** — `programs/arena`
- C1 Arena escrow + entry pass — **not implemented**, instruction bodies are TODO stubs
- C2 Payout/pool settlement — **not implemented**
- C3 Winner badge + result hash — **not implemented**
- C4 Payout Service (backend↔chain bridge) — **no code exists** (`find apps/api/src -iname "*payout*"` → nothing); `PayoutScreen.tsx` and `Payout` DB rows are referenced elsewhere but there's no service driving them
- C5 Wallet/Identity backend (sign-in with Solana) — **not implemented**; current `gateway/auth.ts` is explicitly a placeholder ("no wallet-signature verification yet — that's C5's charter"), issues sessions from a bare wallet address with no signature check. Note: `apps/api/src/live/auth/wallet.service.ts` is unrelated — it's a devnet keypair loader for signing TxLine feed-subscribe calls, not C5.

**Frontend track**
- F1 App shell/routing/wallet adapter — only a 29-line `App.tsx` exists, no wallet adapter integrated
- F2 Match Lobby + Entry Pass purchase — `LobbyScreen.tsx` is a 9-line placeholder, no buy-tx flow
- F3 Live Arena + Prediction Card — `ArenaScreen.tsx` placeholder, not wired to B7 WS
- F4 Leaderboard + Spectator + Summary — `LeaderboardScreen.tsx`, `SpectatorScreen.tsx`, `SummaryScreen.tsx` all placeholders (8–9 lines each)
- F5 Winner/Payout screen — `PayoutScreen.tsx` placeholder

All six files in `apps/web/src/screens/` are scaffolds only (8–9 lines, no logic, no data fetching). `apps/web/package.json` has React Router and `@arena/contracts` wired but no wallet-adapter, no data-fetching/WS client library yet.

## Next steps (suggested order, per build plan critical path)

1. **C5 wallet/identity** — smallest on-chain-adjacent piece, unblocks real auth in `gateway/auth.ts` and F1.
2. **C1 Arena escrow + entry pass** — fill in `init_arena`/`buy_entry` logic in `programs/arena/programs/arena/src/lib.rs`, run `anchor build` for the first time to generate the IDL (currently never built).
3. **F1 → F2** — wallet adapter + lobby/entry-purchase screen, now that C1/C5 exist to connect to.
4. **F3 → F4** — wire `ArenaScreen`/`LeaderboardScreen`/`SpectatorScreen`/`SummaryScreen` to the already-working B7 WS/REST gateway (backend side is ready and waiting).
5. **C2 payout + C4 payout service** — settle_payout on-chain instruction + the backend bridge listening to B6 leaderboard finalization; currently zero code on the C4 side.
6. **C3 winner badge/result hash** — record_result instruction + F5 payout screen once C2/C4 land.
7. Formal **B8 Replay Engine** polish (speed control ×1…×N) — currently only single-speed fixture replay exists inside B1/B7.

Milestone read: **M1 (vertical slice)** is ~60% there — backend chain B1→B7 is fully built and tested, but M1 also requires C1 `buy_entry` on devnet and F1/F2 connect+buy, neither of which exist yet. **M2/M3** are far off — entire on-chain payout/badge track and entire frontend are outstanding.
