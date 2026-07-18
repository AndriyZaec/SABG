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

export const db = drizzle(queryClient, { schema });

export async function checkDatabaseConnection(): Promise<void> {
  await queryClient`select 1`;
}

export async function closeDatabaseConnection(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
