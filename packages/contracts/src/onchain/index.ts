// Anchor IDL + generated program type, so consumers don't need the Rust toolchain.
// Artifacts are copied here from `programs/arena/target` by `pnpm idl:sync` after
// `anchor build`. Do not edit `arena.ts` / `arena.idl.json` by hand.

import type { Arena } from "./arena.js";
import arenaIdl from "./arena.idl.json";

/** Generated Anchor program type. Renamed to avoid clashing with the `Arena` entity. */
export type { Arena as ArenaProgram } from "./arena.js";

/** Runtime IDL — pass to `new Program(ARENA_IDL, provider)`. */
export const ARENA_IDL = arenaIdl as Arena;

/** Deployed program id (devnet). */
export const ARENA_PROGRAM_ID: string = arenaIdl.address;
