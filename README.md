# SABG

**Sports Arena Battle Ground**

Live CS2 predictions. Elimination rounds. On-chain prizes.

## What SABG is

SABG is a live CS2 survival prediction game. Players follow the same match, answer shared Yes/No
questions, and compete to stay in the arena. Correct answers keep them in the game; wrong or missed
answers eliminate them.

Each map has its own arena. Entry fees and prize-pool settlement run on **Solana devnet**. Live match
processing, predictions, elimination, and realtime updates stay off-chain.

## How the game works

1. Browse the CS2 schedule and open a series to see its maps and available arenas.
2. Connect a Solana wallet, sign in, and buy an entry while the arena is open for entry.
3. Answer Yes/No questions about upcoming CS2 rounds before their prediction windows lock.
4. Live provider data determines the result; wrong or missed answers eliminate the player.
5. The remaining winner or winners receive the escrowed prize pool through an on-chain payout.

The frontend includes live predictions, survivor counts, leaderboards, results, optional stream
viewing, and push notifications for arena availability.

## Architecture

```text
Provider API -> series lifecycle -> round signals -> prediction settlement
             -> player outcomes -> typed WebSocket updates -> React client
Solana devnet: arena provisioning -> entry escrow -> payouts / cancellation refunds
```

- **Autopilot** selects eligible series from the active tournament, follows their lifecycle, and
  opens an arena for each map.
- **Round engines** open and lock prediction windows from live round signals. Settlement evaluates
  shared conditions without side effects; incomplete evidence can void a prediction round.
- **PostgreSQL** stores durable game state and scheduled jobs. Optional **MongoDB** recording stores
  raw provider data.
- **Shared contracts** define domain types, DTOs, settlement conditions, and WebSocket messages.
- **Admin and operator tools** manage tournament publication, series priority, streams, and autopilot.

## Solana integration

The Anchor program initializes arenas and escrow PDAs, issues one entry pass per wallet per arena,
rejects duplicate entries, and enforces authority-gated settlement and cancellation. Cancelled
arenas support entry refunds.

The backend provisions on-chain arenas when enabled, verifies and relays wallet-signed entry
transactions, and submits authority-signed payouts. Game logic remains off-chain.

This repository targets **Solana devnet only**.

## Stack and repository

React, Vite, Solana Wallet Adapter, Node.js, TypeScript, Express, WebSocket, PostgreSQL, Drizzle ORM,
pg-boss, MongoDB, Anchor, Docker Compose, and Caddy.

```text
apps/
  api/          # provider ingestion, game engines, realtime gateway, persistence, payouts
  web/          # React/Vite PWA: schedule, series, arenas, wallet, results, devnet guide
  admin/        # operator dashboard and authenticated control client
  operator/     # local keyboard-driven operator TUI
packages/
  auth/         # shared wallet authentication utilities
  contracts/    # shared types, DTOs, WebSocket catalog, settlement conditions
programs/arena/ # Anchor program for entry escrow, payout, and refunds
deploy/         # service env templates, proxy configuration, operational scripts
compose.yml     # Docker service topology
```

## Run locally

Requirements: **Node 22** and **pnpm**. Copy `apps/api/.env.example` and `apps/web/.env.example` to their
respective `.env` files and configure the services needed for your chosen runtime.

```bash
pnpm install
pnpm contracts:build
pnpm -r typecheck
```

For the CS2 runtime, configure PostgreSQL and provider credentials, apply migrations with
`pnpm --filter @arena/api db:migrate:local`, then run these in separate terminals.
Set `VITE_MOCK_API=false` in `apps/web/.env` to use the real backend.

```bash
pnpm --filter @arena/api cs2:dev
pnpm dev:web
```

For standalone mock UI development, use `pnpm dev:api` and `pnpm dev:web` with mock mode enabled.
Other commands:

```bash
pnpm dev:admin            # admin dashboard
pnpm event-control        # remote operator TUI
pnpm -r test              # workspace tests
pnpm build                # workspace build
```

Build the Solana program with `anchor build` from `programs/arena`.

Local API settings live in `apps/api/.env`; Docker services use their respective `deploy/*.env`
files, created from the committed examples. On-chain provisioning requires
`ONCHAIN_ARENAS_ENABLED=true` and `ARENA_AUTHORITY_SECRET` for a funded devnet authority wallet.
Secrets must not be committed.
