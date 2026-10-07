// Anchor IDL + generated program type, so consumers don't need the Rust toolchain.
// Artifacts are copied here from `programs/arena/target` by `pnpm idl:sync` after
// `anchor build`. Do not edit `arena.ts` / `arena.idl.json` by hand.

import type { Arena } from "./arena.js";
import arenaIdl from "./arena.idl.json" with { type: "json" };

/** Generated Anchor program type. Renamed to avoid clashing with the `Arena` entity. */
export type { Arena as ArenaProgram } from "./arena.js";

/** Runtime IDL — pass to `new Program(ARENA_IDL, provider)`. */
export const ARENA_IDL = arenaIdl as Arena;

/** Deployed program id (devnet). */
export const ARENA_PROGRAM_ID: string = arenaIdl.address;

/** Fixed settlement economics for the current devnet program. */
export const ARENA_PLATFORM_FEE_BPS = 1_000;
export const ARENA_TREASURY_ADDRESS = "nvy4VWVymKZpYZEBtwNYUzJzG9R11P7Wc7khvenMpzW";

export function calculatePlatformFeeLamports(grossPoolLamports: number): number {
  if (!Number.isSafeInteger(grossPoolLamports) || grossPoolLamports < 0) {
    throw new RangeError("Gross prize pool must be a non-negative safe integer");
  }

  const basisPointScale = 10_000;
  const wholeUnits = Math.floor(grossPoolLamports / basisPointScale);
  const remainder = grossPoolLamports % basisPointScale;
  return (
    wholeUnits * ARENA_PLATFORM_FEE_BPS +
    Math.floor((remainder * ARENA_PLATFORM_FEE_BPS) / basisPointScale)
  );
}
