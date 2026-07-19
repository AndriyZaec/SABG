# SABG — Sports Arena Battle Ground

Sports Arena Battle Ground: a live football survival prediction game on Solana devnet, built for the
TxODDS World Cup Hackathon (**Consumer & Fan Experiences** track).
Read the game. Survive the match.

## The idea

Watching a match with friends is fun. Watching it while a wrong prediction can knock you out is
more fun. SABG turns a live football match into a synchronous, elimination-style prediction arena:

1. Fans join an **Arena** for a real fixture before kickoff and buy an entry pass on-chain
   (Solana devnet) — their stake goes into the arena's prize pool escrow.
2. The match is split into fixed 5-minute windows. Before each window, every surviving player
   gets the **same** context-aware Yes/No question (e.g. *"Will there be a corner between 20:00
   and 25:00?"*), generated from the live match state (score, momentum, shots, cards, etc.).
3. Each question opens as soon as the previous window locks, so players get almost the full
   5-minute window to answer — and can change their mind — before the round locks at the next
   window boundary.
4. Live match events from the **TxODDS** feed settle the round deterministically — no human
   judgment calls, only whitelisted, unambiguous events (goal, shot, shot on target, corner,
   card, penalty, substitution).
5. Wrong or missed answers eliminate a player; correct ones carry them into the next round.
6. Survivors split the on-chain prize pool at full time.

Spec & plan live in [`docs/`](./docs) (`spec_v2.md` is the source of truth).

## What's actually working

This isn't a mockup — the core loop runs end-to-end against real data and real transactions:

- **Live ingestion** of the TxODDS match feed, normalized into an internal event stream, with a
  fixture-replay mode for demos/dev that doesn't depend on a live match being in progress.
- **Deterministic settlement engine**: a pure `(condition, events[]) => result` function, unit
  tested against early-settlement, window-end, and idempotency edge cases.
- **Context-aware question generation** driven by live match state, not a static question bank.
- **Realtime gateway** (WebSocket + REST) pushing round state, eliminations, and leaderboard
  updates to every connected client, backed by Postgres.
- **On-chain escrow and payout on Solana devnet**: arena creation, entry-pass purchase, and
  prize-pool settlement have been run for real against a deployed Anchor program, verified via
  wallet balance deltas and on-chain transaction signatures — not just localnet unit tests.
- **A full React/Vite PWA**: wallet-connected lobby, live arena screen with the prediction card
  and match feed, leaderboard, spectator mode, match summary, and payout screen.
- **A production deploy path**: Dockerized services (API, Postgres, Mongo for feed caching) behind
  Caddy, shipped as immutable GHCR image digests, with guarded scripts for switching an event
  between replay and live sources and cycling demo replays continuously.

## Brief technical documentation

**Core idea:** turn a live match into a synchronous elimination game — everyone answers the same
whitelisted-event question on the same clock, wrong or missed answers eliminate you, and survivors
split an on-chain (Solana devnet) prize pool. See "The idea" and "What's actually working" above.

**Technical highlights:**

- The settlement condition is restricted to a small whitelist of unambiguous, discretely-detected
  TxODDS events (goal, shot, shot on target, corner, card, penalty, substitution) specifically so
  outcomes are deterministic and never require human judgment.
- The round planner (`apps/api/src/round-engine/planner.ts`) is a pure function over match-clock
  ticks — no I/O, no wall clock — so timing logic is fully unit-testable in isolation from the
  feed and the gateway.
- TxLINE access itself runs through an on-chain subscription flow (devnet): the backend holds a
  dedicated devnet wallet, subscribes to a TxLINE service level via an Anchor program call, then
  activates the subscription by signing a message with that transaction's signature to receive an
  API token — all before it can call any market-data endpoint.

**TxLINE endpoints used** (`apps/api/src/live/`, base `https://txline-dev.txodds.com`):

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/guest/start` | Obtain a short-lived guest JWT, used to activate the TxLINE subscription. |
| `POST /api/token/activate` | Activate the on-chain TxLINE subscription (signed message + tx signature) and receive the API token used for all subsequent calls. |
| `GET /api/fixtures/snapshot` | Discover the current World Cup fixture (competition id `72`) to stream. |
| `GET /api/scores/stream` | Long-lived SSE connection streaming live match events (shots, corners, cards, goals, etc.) for a given `fixtureId`, resumable via `Last-Event-ID`. |

## Feedback: our experience with the TxLINE API

**What we liked:**

- `/api/scores/stream` is a genuinely good real-time primitive for this kind of game: a long-lived
  SSE connection with `Last-Event-ID` resume made it straightforward to reconnect after a network
  blip without missing or duplicating events, which matters a lot for a settlement engine that
  has to be idempotent.
- The discrete, well-typed event vocabulary (shots, corners, cards, goals, substitutions) maps
  almost directly onto our settle-able event whitelist — we didn't have to invent our own
  event-classification layer on top of the feed.
- Token-gating access through an on-chain devnet subscription is a neat fit for a Solana-native
  hackathon: it meant our data access and our game's payments both lived in the same trust model.

**Where we hit friction:**

- The on-chain subscription/activation flow (subscribe via an Anchor program call → obtain a
  guest JWT → sign a message combining the tx signature and JWT → activate to get an API token)
  is several steps deep before a single market-data call can be made. It works, but it's a lot of
  vendor-specific wiring (`apps/api/src/live/auth/txline.service.ts`) for what is ultimately just
  "get me an API key."
- `GET /api/fixtures/snapshot`'s `GameState` field isn't documented reliably enough to trust on
  its own — the same value (`1`) shows up on both a fixture that's about to kick off and one
  that's months away. We ended up ignoring it and selecting the current fixture purely by
  `StartTime` proximity instead.
- The live event stream identifies participants by opaque numeric ids for at least one fixture we
  worked with, with no resolvable team name in the feed itself — we had to fall back to a manual
  name mapping rather than trusting the feed end-to-end.
- Devnet TxLINE token funding is aggressively rate-limited from a typical dev/CI environment, so
  we had to fund by transferring from an already-funded wallet rather than hitting the faucet
  directly during iteration.

## Layout

```
SABG/
├── apps/
│   ├── api/          # backend (Node/TS) — ingestion, match state, round & settlement engines,
│   │                  # question generator, leaderboard, realtime gateway, on-chain payout bridge
│   └── web/           # React + Vite PWA — lobby, live arena, leaderboard, spectator, summary, payout
├── packages/
│   └── contracts/     # @arena/contracts — shared types, DTOs, WS catalog, settlement DSL
├── programs/
│   └── arena/          # Anchor / Solana program — escrow, entry, payout
├── deploy/             # Docker Compose + Caddy production stack, GHCR image deploy scripts
└── docs/                # spec v1/v2 + build plan
```

### Principles

- `@arena/contracts` is the single source of truth for shared shapes — types, enums, DTOs, WS
  messages, and the settlement DSL live there and are imported everywhere.
- Game/business logic stays off-chain; the Solana program only handles funds, identity, and final
  result, with its invariants (no double-entry, payout runs once, authority-gated) enforced on-chain.
- The backend is an event pipeline: ingestion normalizes the external feed into an internal event
  stream, stateless engines consume it, and the settlement step is a pure, idempotent function.
- Realtime communication goes over a typed WS message catalog, not ad-hoc payloads.

## Tech stack

- **Backend:** Node 22, TypeScript (strict), Express, `ws`, Drizzle ORM + Postgres, MongoDB (feed
  caching for the live TxODDS source), Zod, Pino.
- **Frontend:** React 18, Vite, React Router, Solana wallet-adapter, PWA.
- **On-chain:** Anchor / Solana (devnet).
- **Ops:** Docker Compose, Caddy, GHCR immutable image deploys.

## Getting started (TS workspace)

```bash
pnpm install               # install the whole workspace
pnpm contracts:build       # build shared @arena/contracts and @arena/auth
pnpm -r typecheck          # typecheck every package

pnpm dev:api                # run the backend against a fixture replay
pnpm dev:web                # run the frontend
```

```bash
cd programs/arena
anchor build                # build the Solana program + generate the IDL
```

- Node 22 (`.nvmrc`), pnpm workspaces (`apps/*`, `packages/*`).
- Import shared types from `@arena/contracts` everywhere — don't redefine them.
- `pnpm -r test` runs the test suite (unit + integration tests for ingestion, match state,
  round engine, settlement, question generator, leaderboard, and the gateway).

## Devnet only

This hackathon build runs entirely against Solana **devnet** — no mainnet keys or funds are
involved anywhere in the repo.
