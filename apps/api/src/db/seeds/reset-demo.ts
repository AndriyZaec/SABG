import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { parseDemoResetRequest } from "../demo-reset-config.js";

dotenv.config();

async function main(): Promise<void> {
  const { fixtureId, database } = parseDemoResetRequest(process.argv, process.env);

  const { closeDatabaseConnection } = await import("../client.js");

  try {
    const { resetDemoFixture } = await import("../demo-reset.js");
    const audit = await resetDemoFixture(fixtureId, database);
    const auditJson = `${JSON.stringify(audit, null, 2)}\n`;
    process.stdout.write(auditJson);
    const auditDir = process.env["DEMO_RESET_AUDIT_DIR"];
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      const safeTimestamp = audit.timestamp.replaceAll(":", "-");
      await writeFile(path.join(auditDir, `demo-reset-${fixtureId}-${safeTimestamp}.json`), auditJson, {
        flag: "wx",
      });
    }
  } finally {
    await closeDatabaseConnection();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
