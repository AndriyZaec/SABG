# @arena/api — Backend

**Owner:** V. Ingestion, engines, realtime gateway, payout bridge (build plan B1–B8, C4–C5).

## Status

- **P0.3 — DB schema + migrations:** done. Postgres schema for spec v2 §13 via Drizzle ORM
  (`src/db/schema.ts`), migrations under `src/db/migrations/`.
- **P0.4 — REST + WS mock server:** done. `src/mock/` implements the S2 DTO + WS catalog
  (`@arena/contracts`) against fixture data, so frontend (F3/F4) can develop without the real
  backend. `openapi.yaml` documents the REST surface.
- **B1–B8 engines, B7 real Realtime Gateway:** not started — `src/mock/` is a stand-in until then.

## Running the mock server

```bash
pnpm install                # from repo root
pnpm dev:api                # boots the P0.4 mock: REST :4000/api, WS :4000/ws
```

`apps/web/vite.config.ts` proxies `/api` and `/ws` to `localhost:4000`, so `pnpm dev:web` talks
to this mock automatically. `MOCK_LEAD_MS` env var shortens the round lead time (default 60s,
per spec §5) for faster manual testing, e.g. `MOCK_LEAD_MS=2000 pnpm dev:api`.

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
