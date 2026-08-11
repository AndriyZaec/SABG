// Singleton pino logger for the Grid.gg poller — mirrors src/live/logger.ts's redaction
// approach, scoped to the one secret this service handles: the Grid API key.

import pino from "pino";
import { gridConfig } from "./config/env.js";

const isProd = gridConfig.log.nodeEnv === "production";

export const logger = pino({
  level: gridConfig.log.level,
  redact: {
    paths: [
      "apiKey",
      "*.apiKey",
      "headers.x-api-key",
      'headers["x-api-key"]',
      "err.config.headers.x-api-key",
      'err.config.headers["x-api-key"]',
      "uri",
      "mongoUri",
      "*.uri",
      "*.mongoUri",
    ],
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
