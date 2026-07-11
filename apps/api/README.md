# @arena/api — Backend

**Owner:** V. Ingestion, engines, realtime gateway, payout bridge (build plan B1–B8, C4–C5).

## Status

- **P0.3 — DB schema + migrations:** done. Postgres schema for spec v2 §13 via Drizzle ORM
  (`src/db/schema.ts`), migrations under `src/db/migrations/`.
- **P0.4 — REST + WS mock server:** done. `src/mock/` implements the S2 DTO + WS catalog
  (`@arena/contracts`) against fixture data, so frontend (F3/F4) can develop without the real
  backend. `openapi.yaml` documents the REST surface.
- **B1 — TxODDS Ingestion + WS Parser:** done. `src/ingestion/` normalizes raw TXODDS Soccer
  Scores messages into the whitelisted `LiveEvent` shape (`@arena/contracts`), derives the
  match minute from the feed's accumulating `Clock.Seconds`, and publishes onto an in-process
  `LiveEventBus` (S3). `incident-tracker.ts` collapses each incident's provisional/confirmed/
  discard message sequence (correlated by the feed's `Id`) into a single confirmed-only
  emission per incident — deliberately simple, `action_amend` isn't handled yet. `replay.ts`
  plays back the recorded fixture `__fixtures__/fixture-18179764.json`. Run `pnpm test` for the
  unit tests.
- **Live SSE worker (ahead of its B7 slot):** done. `src/live/` connects to the real TXODDS
  `/scores/stream` feed for one fixture, authenticating via the TxLine on-chain subscribe +
  guest JWT flow (ported from an earlier draft project, `world-cup`), persists every raw
  message to MongoDB (`live_stream_events`, a dedicated `sabg_raw` db), and runs each message
  through the same `ingestion/incident-tracker.ts` used by `replay.ts`, publishing confirmed
  `LiveEvent`s onto a `LiveEventBus`. Reconnect/backoff and a post-finish settle window are
  ported from the draft; the SSE cursor and TxLine/guest tokens are cached **in-memory only**
  (no Redis in this repo) — a process restart re-authenticates and re-subscribes from the
  feed's current position rather than resuming exactly. Run `pnpm live:dev` — see
  `.env.example` for the required `SOLANA_WALLET_PRIVATE_KEY` / `MONGODB_URI` (**devnet only**,
  per this repo's security policy).
- **B2–B8 engines, B7 real Realtime Gateway:** not started — `src/mock/` is a stand-in until then.

## Running the mock server

```bash
pnpm install                # from repo root
pnpm dev:api                # boots the P0.4 mock: REST :4000/api, WS :4000/ws
```

`apps/web/vite.config.ts` proxies `/api` and `/ws` to `localhost:4000`, so `pnpm dev:web` talks
to this mock automatically. `MOCK_LEAD_MS` env var shortens the round lead time (default 60s,
per spec §5) for faster manual testing, e.g. `MOCK_LEAD_MS=2000 pnpm dev:api`.

## Running the live worker

```bash
cp .env.example .env        # set SOLANA_WALLET_PRIVATE_KEY (devnet), MONGODB_URI, etc.
docker compose up -d        # brings up both Postgres (:5433) and Mongo (:27018)
pnpm live:dev                # connects to the real TXODDS SSE feed, logs each LiveEvent
```

Requires a real devnet wallet with a TxLine subscription (see `src/live/auth/txline.service.ts`
— it calls the TxLine program's `subscribe()` instruction on first run) and MongoDB reachable
at `MONGODB_URI`. `TXODDS_LIVE_FIXTURE_ID` (default `18179764`, the same fixture the B1 export
uses) selects which fixture to stream.

## Database

```bash
cp .env.example .env        # set DATABASE_URL (docker-compose default or your own Postgres)
docker compose up -d        # optional: local Postgres on :5433 (see docker-compose.yml)
pnpm db:generate             # emit a migration from src/db/schema.ts
pnpm db:migrate              # apply migrations
```

Schema, enums and FKs mirror spec v2 §13 exactly; enum values are derived at runtime from
`@arena/contracts` (`packages/contracts/src/enums.ts`) so the DB never drifts from the shared
types. `created_at`/`updated_at` on every table, with a Postgres trigger keeping `updated_at`
current on `UPDATE`.

## Conventions

Import shared types from `@arena/contracts` (entities, enums, DTOs, WS catalog, settlement
DSL) instead of redefining them locally — that package is the S1 seam. See `../../docs/` for
spec v2 & the build plan.
