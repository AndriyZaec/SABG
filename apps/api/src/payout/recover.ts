import { closeDatabaseConnection } from "../db/client.js";
import { recoverPayout } from "./index.js";

try {
  const [, , action, arenaId] = process.argv;
  if ((action !== "retry" && action !== "cancel") || !arenaId) {
    throw new Error("Usage: tsx src/payout/recover.ts <retry|cancel> <arena UUID>");
  }
  await recoverPayout(arenaId, action);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
