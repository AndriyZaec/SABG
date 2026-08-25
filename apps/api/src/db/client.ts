import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

dotenv.config();

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

const queryClient = postgres(databaseUrl);

const FIXTURE_RUNTIME_LOCK_NAMESPACE = 1_397_315_407;
const CS2_SERIES_RUNTIME_LOCK_NAMESPACE = 1_397_315_408;

export type ReleaseFixtureRuntimeLock = () => Promise<void>;

export const db = drizzle(queryClient, { schema });

export async function checkDatabaseConnection(): Promise<void> {
  await queryClient`select 1`;
}

// Keep the reserved session locked so cleanup cannot race an active gateway across containers.
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

export async function tryAcquireSeriesRuntimeLock(
  gridSeriesId: string,
): Promise<ReleaseFixtureRuntimeLock | undefined> {
  const connection = await queryClient.reserve();
  try {
    const [row] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(${CS2_SERIES_RUNTIME_LOCK_NAMESPACE}, hashtext(${gridSeriesId})) as acquired
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
        select pg_advisory_unlock(${CS2_SERIES_RUNTIME_LOCK_NAMESPACE}, hashtext(${gridSeriesId}))
      `;
    } finally {
      connection.release();
    }
  };
}

export async function closeDatabaseConnection(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
