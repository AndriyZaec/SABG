import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { closeDatabaseConnection, db } from "./client.js";

async function main(): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("./migrations/", import.meta.url));
  try {
    await migrate(db, { migrationsFolder });
    console.log("database migrations complete");
  } finally {
    await closeDatabaseConnection();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
