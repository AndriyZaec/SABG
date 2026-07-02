# @arena/api — Backend (placeholder)

**Owner:** Viktor. This slot is intentionally empty — drop the existing backend repo here.

## How to bring the backend in

The root `pnpm-workspace.yaml` globs `apps/*`, so this becomes a workspace package
as soon as it has a `package.json`. To integrate:

1. Copy the backend source into `apps/api/` (keep its own `package.json`, `tsconfig`, etc.).
2. Name the package `@arena/api` (or update root scripts `dev:api` / filters accordingly).
3. Add the shared contracts as a dependency:
   ```jsonc
   // apps/api/package.json
   "dependencies": {
     "@arena/contracts": "workspace:*"
   }
   ```
   Import shared types from `@arena/contracts` (entities, enums, DTOs, WS catalog,
   settlement DSL) instead of redefining them locally — that package is the S1 seam.
4. From the repo root: `pnpm install`, then `pnpm dev:api`.

## Scope (build plan B1–B8, C4–C5)

Ingestion (B1), Match State (B2), Round (B3), Settlement (B4), Question Generator (B5),
Leaderboard (B6), Realtime Gateway + REST (B7), Replay (B8), Payout bridge (C4),
Wallet/Identity (C5). See `../../docs/` for spec v2 & build plan.
