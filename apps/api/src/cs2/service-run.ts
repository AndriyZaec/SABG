import { cs2Config } from "./config/env.js";

const entrypoint = cs2Config.mode === "live" ? "./run.js" : "./catalog-run.js";

import(entrypoint).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`CS2 service failed to load ${cs2Config.mode} runtime: ${message}\n`);
  process.exitCode = 1;
});
