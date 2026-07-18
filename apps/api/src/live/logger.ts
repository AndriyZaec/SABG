// Ported from world-cup's utils/logger.ts. Singleton pino logger with secret redaction —
// the live worker's auth chain handles a wallet key, guest JWT, and TxLine API token, none of
// which should ever reach log output.

import pino from "pino";
import { liveConfig } from "./config/env.js";

const isProd = liveConfig.log.nodeEnv === "production";

export const logger = pino({
  level: liveConfig.log.level,
  redact: {
    paths: [
      "apiToken",
      "jwt",
      "token",
      "walletSignature",
      "privateKey",
      "uri",
      "mongoUri",
      "*.apiToken",
      "*.jwt",
      "*.token",
      "*.walletSignature",
      "*.authorization",
      "*.Authorization",
      "*.uri",
      "*.mongoUri",
      "headers.authorization",
      'headers["x-api-token"]',
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
