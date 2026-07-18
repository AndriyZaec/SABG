import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { parseReplayResetRequest } from "../replay-reset-config.js";

dotenv.config();

async function main(): Promise<void> {
  const { fixtureId, database, requireEmptyOffchain } = parseReplayResetRequest(process.argv, process.env);

  const { closeDatabaseConnection } = await import("../client.js");

  try {
    const { resetReplayFixture } = await import("../replay-reset.js");
    const audit = await resetReplayFixture(fixtureId, database, { requireEmptyOffchain });
    const auditJson = `${JSON.stringify(audit, null, 2)}\n`;
    process.stdout.write(auditJson);
    const auditDir = process.env["REPLAY_RESET_AUDIT_DIR"];
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      const safeTimestamp = audit.timestamp.replaceAll(":", "-");
      await writeFile(path.join(auditDir, `replay-reset-${fixtureId}-${safeTimestamp}.json`), auditJson, {
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
