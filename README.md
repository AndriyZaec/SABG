# SABG

**Sports Arena Battle Ground**

Live football predictions. Elimination rounds. On-chain prizes.

Powered by **TxLINE from TxODDS**.

## What SABG is

SABG is a live football survival game. Everyone in an arena follows the same match, receives the
same prediction question, and answers against the same match clock. Correct answers keep a player
in the game; wrong or missed answers eliminate them.

Entry passes and prize-pool settlement run on Solana devnet. Match processing, game rules, and
realtime updates stay off-chain, where they can react to the live feed without putting
high-frequency game logic on Solana.

## How the game works

1. Connect a Solana wallet and join an arena before kickoff. The entry fee goes into on-chain escrow.
2. Every five minutes, all active players answer the same Yes/No question about the live match.
3. TxLINE events determine the correct answer.
4. A wrong or missed answer eliminates the player.
5. The remaining winner or winners receive the escrowed prize pool through an on-chain payout.

## Why it matters

Most second-screen football products show more information but do not change how fans participate.
SABG gives everyone a shared decision at the same moment in the match. The elimination format keeps
the state easy to understand, while on-chain entry and payout make the financial outcome visible
and verifiable.

The product is designed as a consumer game first. The same arena format can also support private
fan groups, creator communities, or match-day experiences operated by a sports platform.

## System flow

```text
TxLINE SSE -> normalization -> match state -> round planning
           -> deterministic settlement -> WebSocket updates -> React client
```

- **Ingestion** converts TxLINE score snapshots into a small internal event vocabulary.
- **Match state** maintains the clock, score, possession, shots, corners, and cards used by the UI
  and question generator.
- **Round planning** opens and locks prediction windows from match-clock ticks rather than server
  wall-clock timers.
- **Settlement** evaluates a condition against normalized events as a pure, idempotent operation.
- **Realtime delivery** sends match, round, player, and leaderboard updates through a typed
  WebSocket message catalog.
- **PostgreSQL** stores durable game state. **MongoDB** stores and indexes raw live-stream events for
  reconnection and auditability.
- **Solana** holds entry funds and executes the final payout.

The gateway can run from either the live TxLINE source or a recorded fixture. Both sources publish
the same internal signals, so the game engines do not contain separate live and replay logic.

## Technical highlights

- Shared DTOs, domain types, settlement conditions, and WebSocket messages live in
  `@arena/contracts`.
- The settlement function is side-effect-free and can be replayed safely over the same events.
- SSE consumption resumes with `Last-Event-ID`; persisted sequence numbers prevent duplicate event
  processing after reconnects.
- The lobby closes from fixture kickoff metadata. Replay timing remains independently configurable.
- Entry submission verifies the wallet signature and the intended `buy_entry` instruction before
  relaying it to Solana. Wallet-added compute-budget instructions are accepted, while added
  transfers, programs, accounts, or signers are rejected.
- The production stack uses Docker Compose, Caddy, PostgreSQL, and MongoDB. Release deployments use
  immutable GHCR image digests and guarded replay/live source transitions.

## TxLINE integration

The backend uses a dedicated Solana devnet wallet for TxLINE access. It creates or restores the
on-chain subscription, obtains a guest JWT, signs the activation message, and exchanges it for the
API token used by fixture and score requests.

Base URL: `https://txline-dev.txodds.com`

| Endpoint | Usage in SABG |
| --- | --- |
| `POST /auth/guest/start` | Creates the short-lived guest JWT required during subscription activation. |
| `POST /api/token/activate` | Activates the on-chain subscription using a signed message and returns the API token. |
| `GET /api/fixtures/snapshot` | Loads World Cup fixtures and selects or validates the fixture used by the arena. |
| `GET /api/scores/stream` | Opens the resumable SSE stream for a specific `fixtureId`. |

Fixture discovery filters the snapshot by competition and kickoff proximity. Before a live switch,
the operator pins the selected fixture ID and runs the same preflight again, preventing the event
from starting on an ambiguous fixture.

## Solana integration

The Anchor program has a deliberately small responsibility:

- initialize an arena and its escrow PDA;
- issue one entry-pass PDA per player;
- reject duplicate entry for the same arena and wallet;
- hold entry fees in escrow;
- allow an authority-gated payout exactly once.

Question generation, event ingestion, answer evaluation, elimination, and leaderboard calculation
remain off-chain. The backend provisions arenas, relays wallet-signed entry transactions, and sends
the authority-signed winner set used to release escrow funds.

This repository targets **Solana devnet only**. It contains no mainnet configuration or funds.

## Stack

- **Web:** React, Vite, Solana Wallet Adapter
- **API:** Node.js, TypeScript, Express, WebSocket
- **Data:** PostgreSQL, MongoDB, Drizzle ORM
- **Blockchain:** Solana devnet, Anchor
- **Operations:** Docker Compose, Caddy, GHCR

## Repository structure

```text
SABG/
├── apps/
│   ├── api/          # ingestion, game engines, realtime gateway, persistence, payout bridge
│   └── web/          # React/Vite PWA: lobby, arena, match feed, leaderboard, summary
├── packages/
│   ├── auth/         # shared wallet authentication utilities
│   └── contracts/    # shared types, DTOs, WebSocket catalog, settlement conditions
├── programs/
│   └── arena/        # Anchor program for arena identity, entry escrow, and payout
├── deploy/           # event control, replay/live switching, Caddy, and database setup
└── compose.yml       # production service topology
```

## Run locally

Requirements: Node 22 and pnpm.

```bash
pnpm install
pnpm contracts:build
pnpm -r typecheck
pnpm -r test
```

Run the mock API and web client in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Build the Solana program and generate its IDL:

```bash
cd programs/arena
anchor build
```

Environment templates are provided in `apps/api/.env.example`, `apps/web/.env.example`, and
`deploy/*.env.example`. Wallet keys and TxLINE credentials must be supplied through local or
deployment secrets and must not be committed.
