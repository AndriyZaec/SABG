import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { describeDatabase } from "../db/replay-reset-config.js";
import { shouldResetAfterGatewayExit } from "./replay-cycle-policy.js";

dotenv.config();

const gatewayPath = fileURLToPath(new URL("./run.js", import.meta.url));
const resetPath = fileURLToPath(new URL("../db/seeds/reset-replay.js", import.meta.url));

let activeChild: ChildProcess | undefined;
let stopping = false;
let forceKillTimer: NodeJS.Timeout | undefined;

function runChild(modulePath: string, args: string[] = []): Promise<number | null> {
  const child = spawn(process.execPath, [modulePath, ...args], {
    env: process.env,
    stdio: "inherit",
  });
  activeChild = child;

  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  }).finally(() => {
    if (activeChild === child) activeChild = undefined;
  });
}

function stop(signal: NodeJS.Signals): void {
  if (stopping) {
    activeChild?.kill("SIGKILL");
    return;
  }
  stopping = true;
  activeChild?.kill(signal);
  forceKillTimer = setTimeout(() => activeChild?.kill("SIGKILL"), 10_000);
  forceKillTimer.unref();
}

async function main(): Promise<void> {
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  while (!stopping) {
    const gatewayExitCode = await runChild(gatewayPath);
    if (!shouldResetAfterGatewayExit(gatewayExitCode, stopping)) {
      if (!stopping) process.exitCode = gatewayExitCode ?? 1;
      return;
    }

    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
    const fixtureId = process.env["GATEWAY_REPLAY_FIXTURE_ID"] ?? "18179764";
    const database = describeDatabase(databaseUrl);
    const resetExitCode = await runChild(resetPath, [
      fixtureId,
      "--force",
      `--confirm-database=${database}`,
    ]);
    if (stopping) return;
    if (resetExitCode !== 0) {
      throw new Error(`Replay reset failed with exit code ${String(resetExitCode)}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
});
