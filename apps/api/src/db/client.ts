import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

// Load .env here too (idempotent, same as every other config module in this repo) — this file is
// imported directly by the repositories (db/repositories/*.ts), which gateway/run.ts imports
// before gateway/config.ts's own dotenv.config() call runs; without this, whichever config module
// happens to import first "wins" the dotenv load, which is exactly the kind of import-order
// fragility this repo's other config modules (live/config/env.ts, gateway/config.ts) already
// avoid by each loading .env themselves.
dotenv.config();

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

const queryClient = postgres(databaseUrl);

const FIXTURE_RUNTIME_LOCK_NAMESPACE = 1_397_315_407;

export type ReleaseFixtureRuntimeLock = () => Promise<void>;

export const db = drizzle(queryClient, { schema });

export async function checkDatabaseConnection(): Promise<void> {
  await queryClient`select 1`;
}

/**
 * Holds a fixture-scoped session advisory lock on a reserved connection. Reset tooling uses the
 * same lock, so destructive cleanup cannot race an active gateway even across containers.
 */
export async function tryAcquireFixtureRuntimeLock(
  fixtureId: number,
): Promise<ReleaseFixtureRuntimeLock | undefined> {
  const connection = await queryClient.reserve();
  try {
    const [row] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(${FIXTURE_RUNTIME_LOCK_NAMESPACE}, ${fixtureId}) as acquired
    `;
    if (!row?.acquired) {
      connection.release();
      return undefined;
    }
  } catch (error) {
    connection.release();
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection`
        select pg_advisory_unlock(${FIXTURE_RUNTIME_LOCK_NAMESPACE}, ${fixtureId})
      `;
    } finally {
      connection.release();
    }
  };
}

export async function closeDatabaseConnection(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
