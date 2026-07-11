// Replay logger — same pino setup as gateway/logger.ts, scoped to replayConfig so running the
// headless demo never requires the gateway's DB/CORS/auth env vars.

import pino from "pino";
import { replayConfig } from "./config.js";

const isProd = replayConfig.log.nodeEnv === "production";

export const logger = pino({
  level: replayConfig.log.level,
  redact: {
    paths: ["token", "*.token", "*.authorization", "*.Authorization", "headers.authorization"],
    censor: "[REDACTED]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }),
});
