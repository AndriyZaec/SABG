# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Development Commands

```bash
pnpm install               # install the whole workspace
pnpm contracts:build       # build shared @arena/contracts (do this first)
pnpm typecheck             # typecheck every package
pnpm -r typecheck          # fastest way to check TS errors without a full build
pnpm dev:web               # run the React/Vite PWA (apps/web)
pnpm dev:api               # run the backend (apps/api)
pnpm -r test               # run tests across packages

cd programs/arena && anchor build     # build the Solana program + generate IDL
```

- Node 22 (`.nvmrc`); package manager is **pnpm** workspaces (`apps/*`, `packages/*`).

## Architecture

A pnpm monorepo split into three runtimes plus one shared contract package.

```
SABG/
├── apps/
│   ├── api/         # backend (Node/TS): ingestion, engines, realtime gateway, payout bridge
│   └── web/         # React + Vite PWA
├── packages/
│   └── contracts/   # @arena/contracts — shared types, DTOs, WS catalog, settlement DSL
└── programs/
    └── arena/       # Anchor / Solana program: escrow, entry, payout
```

### Principles

- **`@arena/contracts` is the single source of truth for shared shapes.** Types, enums, DTOs,
  WS messages and the settlement DSL live there and are imported everywhere — never redefine
  them locally in `apps/*` or `programs/*`.
- **One-way dependency:** `apps/*` and `programs/*` depend on `packages/*`, never the reverse.
- **Game/business logic stays off-chain.** The Solana program handles only funds, identity and
  final result. Keep on-chain surface minimal and enforce its invariants on-chain
  (double-entry rejected, payout runs once, authority-gated).
- **Backend is an event pipeline:** ingestion normalizes an external feed into an internal
  event stream; stateless engines consume that stream. The core settlement step is a **pure,
  idempotent function** `(condition, events[]) => result` — keep it side-effect-free and
  unit-testable in isolation.
- **Realtime over a typed message catalog.** Server↔client messages use the shared WS types;
  add a new message to the catalog rather than sending ad-hoc payloads.

## Code Style

- **TypeScript strict everywhere** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
  Use type-only imports (`import type`) for types; use ESM `.js` specifiers in TS source.
- **Model domain state with discriminated unions**, not booleans-and-optionals; let the
  compiler enforce exhaustive `switch` handling.
- **Prefer pure functions and small modules.** Isolate side effects (I/O, sockets, chain calls)
  at the edges so core logic stays testable.
- **Frontend:** mobile-first React. Compose small components; extract a component when there's
  real logic or reuse, not for every element. Keep render functions clean.
- **Anchor program:** modular layout — `lib.rs` entry, `state.rs`, `error.rs`. Return typed
  program errors, never panic on user input.
- **Naming:** descriptive and consistent with surrounding code; match existing files' idioms,
  comment density and formatting rather than importing a new style.

## Security & Secrets

- **Never commit secrets.** Keys (e.g. payout authority) and feed credentials come from env /
  a secret manager. `.env` is gitignored; only `.env.example` is committed.
- Devnet only — no mainnet keys or funds in this repo.

## Development Workflow

- **Plan first for non-trivial work.** For anything beyond a small, obvious change, use
  **plan mode** — propose a step-by-step plan and get human approval *before* writing code.
  Don't start executing a multi-step task without an approved plan.
- **Track the current task in `TASK.md`.** For a multi-step task, write the plan, open
  questions and notes into `TASK.md` (a local, git-ignored scratchpad). Update it as the task
  progresses; clear it when the task is done.
- **Execute step by step and pause for verification.** Do one meaningful step at a time and
  let a human verify before moving on, rather than completing the whole task in a single pass.
  Prefer small, reviewable increments.
- **Log mistakes to `@claude_files/errors.md`.** When a mistake is pointed out, append a brief
  entry: what went wrong, the correct approach, and the lesson to avoid repeating it. Put
  prompt/process improvement ideas in `@claude_files/prompt_improvement.md`. Skim these before
  similar work.

## Working with Claude

- **Match the codebase.** Read neighboring files first and follow their conventions; don't
  introduce new patterns or dependencies without reason.
- **Prefer the shared contract.** If a type is missing, add it to `@arena/contracts` and import
  it — don't inline a duplicate shape to move faster.
- **Change the seams deliberately.** Editing shared contracts or the settlement DSL affects
  multiple packages; make such changes intentional and self-consistent across the repo.
- **Keep changes scoped.** Touch only what the task needs; typecheck the affected package(s)
  before considering the change done.
- **Don't run tests to "verify" unless asked** — write correct code first; test runs are a
  separate, explicit step.
- **Ask when a decision is genuinely yours to make** (a product/architecture fork), otherwise
  pick the sensible default and note it.
