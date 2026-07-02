# SABG — Sports Arena Battle Ground

Fan Battle Royale: a live football survival prediction game on Solana devnet.
Read the game. Survive the match.

Spec & plan live in [`docs/`](./docs) (`spec_v2.md` is the source of truth).

## Layout

```
SABG/
├── apps/
│   ├── api/         # backend (Node/TS) — placeholder, Viktor drops his repo here
│   └── web/         # React + Vite PWA frontend (F1–F5)
├── packages/
│   └── contracts/   # @arena/contracts — shared types, DTOs, WS catalog, settlement DSL (S1)
├── programs/
│   └── arena/       # Anchor / Solana program — escrow, entry, payout, badge (C1–C3)
└── docs/            # spec v1/v2 + build plan
```

## Getting started (TS workspace)

```bash
pnpm install
pnpm contracts:build   # build shared @arena/contracts
pnpm dev:web           # run the frontend
```

- Node 22 (`.nvmrc`), pnpm workspaces (`apps/*`, `packages/*`).
- Import shared types from `@arena/contracts` everywhere — don't redefine them.

## Anchor program

```bash
cd programs/arena
anchor build
```

## Ownership (build plan)

- **Viktor:** backend core + realtime (`apps/api`), live arena / leaderboard / spectator (`apps/web` F3–F4).
- **Андрій:** Solana program + payout + wallet (`programs/arena`), wallet / entry / payout screens (`apps/web` F1/F2/F5).
- **Shared:** `packages/contracts` (S1) and the settlement DSL (S5).
