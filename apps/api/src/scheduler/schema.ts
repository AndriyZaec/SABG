import { PgBoss } from "pg-boss";

import { databaseUrl } from "../db/client.js";

// The app role has no DDL rights, so only the migrate step installs or upgrades the pgboss schema.
export async function migrateSchedulerSchema(): Promise<void> {
  const boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
  try {
    await boss.start();
  } finally {
    await boss.stop({ graceful: false });
  }
}
