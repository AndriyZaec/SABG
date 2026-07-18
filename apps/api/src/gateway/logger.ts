// Gateway logger — same pino setup as src/live/logger.ts, but scoped to gatewayConfig so
// booting the gateway never requires the live worker's Mongo/TXODDS env vars.

import pino from "pino";
import { gatewayConfig } from "./config.js";

const isProd = gatewayConfig.log.nodeEnv === "production";

export const logger = pino({
  level: gatewayConfig.log.level,
  redact: {
    paths: [
      "token",
      "*.token",
      "*.authorization",
      "*.Authorization",
      "headers.authorization",
      "err.config.headers.authorization",
      "err.config.headers.Authorization",
      'err.config.headers["x-api-token"]',
      'err.config.headers["X-Api-Token"]',
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
